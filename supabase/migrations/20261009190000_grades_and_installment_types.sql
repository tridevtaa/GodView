-- Grades and instalment types, managed by the owner.
--
-- school_grades: the school's list of grades. `code` is the value stored on
-- enrolments (e.g. "1", "Nursery") and never changes; `label` is what people
-- see ("Class 1") and can be renamed; `sections` lists the sections offered.
--
-- fee_plans: instalment types, i.e. which months a fee falls due. Every
-- school starts with Monthly (Apr to Mar), Bi-yearly (Apr, Oct) and One time
-- (Apr); the owner can add more (e.g. Quarterly: Apr, Jul, Oct, Jan).
--
-- Fee structure (fee heads, plans, amounts per grade) becomes owner-only to
-- change; admins can still read it and collect payments.

-- ----------------------------------------------------------------- grades ---

create table public.school_grades (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  code text not null check (length(trim(code)) between 1 and 40),
  label text not null check (length(trim(label)) between 1 and 40),
  sort int not null default 0,
  sections text[] not null default '{}' check (cardinality(sections) <= 30),
  created_at timestamptz not null default now(),
  unique (school_id, code)
);

-- Nursery, KG 1, KG 2, then 1 to 12; anything else after.
create function public.grade_sort(code text) returns int
language sql immutable set search_path = '' as $$
  select case
    when code ~* '^pre[- ]?nursery$' then -4
    when code ~* '^nursery$' then -3
    when code ~* '^(kg|lkg)\s*1?$' and code !~* '2' then -2
    when code ~* '^(kg\s*2|ukg)$' then -1
    when code ~ '^\d+$' then code::int
    else 100
  end
$$;

-- Starting labels: "1" -> "Grade 1"; others as they are.
insert into public.school_grades (school_id, code, label, sort, sections)
select
  e.school_id,
  e.class,
  case when e.class ~ '^\d+$' then 'Grade ' || e.class else e.class end,
  public.grade_sort(e.class),
  coalesce(array_agg(distinct e.section order by e.section) filter (where coalesce(e.section, '') <> ''), '{}')
from public.student_enrolments e
where coalesce(e.class, '') <> ''
group by e.school_id, e.class
on conflict (school_id, code) do nothing;

-- ---------------------------------------------------------------- plans ---

create table public.fee_plans (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 40),
  -- Calendar months the fee is due in, in session order (Apr = 4 … Mar = 3).
  months int[] not null check (cardinality(months) between 1 and 12 and months <@ array[1,2,3,4,5,6,7,8,9,10,11,12]),
  due_day int not null default 10 check (due_day between 1 and 28),
  is_standard boolean not null default false,
  sort int not null default 0,
  created_at timestamptz not null default now(),
  unique (school_id, name),
  unique (id, school_id)
);

create function public.seed_fee_plans(school uuid) returns void
language sql security definer set search_path = '' as $$
  insert into public.fee_plans (school_id, name, months, is_standard, sort) values
    (school, 'Monthly', array[4,5,6,7,8,9,10,11,12,1,2,3], true, 1),
    (school, 'Bi-yearly', array[4,10], true, 2),
    (school, 'One time', array[4], true, 3)
  on conflict (school_id, name) do nothing
$$;

select public.seed_fee_plans(id) from public.schools;

create function public.schools_seed_plans() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform public.seed_fee_plans(new.id);
  return new;
end
$$;

create trigger schools_seed_plans after insert on public.schools
  for each row execute function public.schools_seed_plans();

-- Fee lines can use a plan instead of the older frequency setting.
alter table public.fee_schedule alter column frequency drop not null;
alter table public.fee_schedule add column plan_id uuid;
alter table public.fee_schedule
  add constraint fee_schedule_plan_fk foreign key (plan_id, school_id)
    references public.fee_plans (id, school_id) on delete restrict;
alter table public.fee_schedule
  add constraint fee_schedule_plan_or_frequency check (plan_id is not null or frequency is not null);

-- ------------------------------------------------------- generate dues ---

-- Same as before, plus plan-based lines: one due per plan month. A class's
-- own amount still replaces the all-classes amount for that fee head.
create or replace function public.generate_invoices(session uuid) returns int
language plpgsql security definer set search_path = '' as $$
declare
  ses public.academic_sessions;
  start_year int;
  line record;
  enr record;
  plan public.fee_plans;
  months_due date[];
  k int;
  steps int;
  step_months int;
  m date;
  per text;
  lbl text;
  inserted int := 0;
  n int;
begin
  select * into ses from public.academic_sessions where id = session;
  if ses.id is null or not public.is_school_admin(ses.school_id) then
    raise exception 'not allowed';
  end if;
  start_year := coalesce(extract(year from ses.starts_on)::int, split_part(ses.name, '-', 1)::int);

  for line in
    select f.* from public.fee_schedule f where f.session_id = session
  loop
    months_due := '{}';
    if line.plan_id is not null then
      select * into plan from public.fee_plans where id = line.plan_id;
      for k in 1 .. cardinality(plan.months) loop
        months_due := months_due || make_date(start_year + case when plan.months[k] < 4 then 1 else 0 end, plan.months[k], 1);
      end loop;
    else
      plan := null;
      steps := case line.frequency when 'monthly' then 12 when 'quarterly' then 4 when 'half_yearly' then 2 else 1 end;
      step_months := 12 / steps;
      for k in 0 .. steps - 1 loop
        months_due := months_due || (make_date(start_year + case when line.start_month < 4 then 1 else 0 end, line.start_month, 1)
          + make_interval(months => k * step_months))::date;
      end loop;
    end if;

    for k in 1 .. cardinality(months_due) loop
      m := months_due[k];
      if line.plan_id is not null or line.frequency = 'monthly' then
        per := to_char(m, 'YYYY-MM');
        lbl := to_char(m, 'Mon YYYY');
      else
        per := case line.frequency
          when 'quarterly' then 'Q' || k
          when 'half_yearly' then 'H' || k
          when 'annual' then 'annual'
          else 'one-time'
        end;
        lbl := case line.frequency
          when 'quarterly' then 'Quarter ' || k
          when 'half_yearly' then 'Half-year ' || k
          when 'annual' then 'Annual'
          else 'One-time'
        end;
      end if;

      for enr in
        select e.student_id from public.student_enrolments e
        where e.session_id = session and e.status <> 'left'
          and (line.class is null or e.class = line.class)
          and not (line.class is null and exists (
            select 1 from public.fee_schedule o
            where o.session_id = session and o.head_id = line.head_id and o.class = e.class
          ))
      loop
        insert into public.fee_invoices (school_id, session_id, student_id, head_id, period, label, amount, due_date)
        values (ses.school_id, session, enr.student_id, line.head_id, per, lbl, line.amount,
                m + (coalesce(plan.due_day, line.due_day) - 1))
        on conflict (student_id, session_id, head_id, period) do nothing;
        get diagnostics n = row_count;
        inserted := inserted + n;
      end loop;
    end loop;
  end loop;
  return inserted;
end
$$;

-- ------------------------------------------------------------ analytics ---

-- Payments received per calendar month within the session's dates.
create function public.fee_monthly_collection(session uuid)
returns table (month date, amount numeric, payments bigint)
language sql stable security invoker set search_path = '' as $$
  select date_trunc('month', p.paid_on)::date, sum(p.amount), count(*)
  from public.fee_payments p
  join public.academic_sessions s on s.id = session and s.school_id = p.school_id
  where p.status = 'success'
    and p.paid_on between coalesce(s.starts_on, '-infinity') and coalesce(s.ends_on, 'infinity')
  group by 1
  order by 1
$$;

-- Billed, collected and dues per class for the session.
create function public.fee_class_summary(session uuid)
returns table (class text, students bigint, billed numeric, collected numeric, due_now numeric, outstanding numeric, students_due bigint)
language sql stable security invoker set search_path = '' as $$
  select
    e.class,
    count(*),
    coalesce(sum(t.billed), 0),
    coalesce(sum(t.paid), 0),
    coalesce(sum(t.due_now), 0),
    coalesce(sum(t.balance), 0),
    count(*) filter (where t.due_now > 0)
  from public.student_enrolments e
  left join public.fee_student_totals t on t.student_id = e.student_id and t.session_id = e.session_id
  where e.session_id = session and e.status <> 'left'
  group by e.class
$$;

-- --------------------------------------------------------------- access ---

revoke execute on function public.seed_fee_plans(uuid) from public, anon, authenticated;
revoke execute on function public.schools_seed_plans() from public, anon, authenticated;
revoke execute on function public.fee_monthly_collection(uuid) from public, anon;
revoke execute on function public.fee_class_summary(uuid) from public, anon;
grant execute on function public.fee_monthly_collection(uuid) to authenticated;
grant execute on function public.fee_class_summary(uuid) to authenticated;

grant select, insert, update, delete on public.school_grades to authenticated;
grant select, insert, update, delete on public.fee_plans to authenticated;

alter table public.school_grades enable row level security;
alter table public.fee_plans enable row level security;

create policy "members read grades" on public.school_grades
  for select to authenticated using (public.is_member(school_id) or public.is_parent_in_school(school_id));
create policy "owner manages grades" on public.school_grades
  for all to authenticated using (public.is_owner(school_id)) with check (public.is_owner(school_id));

create policy "admins read fee plans" on public.fee_plans
  for select to authenticated using (public.is_school_admin(school_id));
create policy "owner manages fee plans" on public.fee_plans
  for all to authenticated using (public.is_owner(school_id) and not is_standard)
  with check (public.is_owner(school_id) and not is_standard);

-- Fee heads and amounts: owner changes, admins read.
drop policy "admins manage fee heads" on public.fee_heads;
create policy "admins read fee heads" on public.fee_heads
  for select to authenticated using (public.is_school_admin(school_id));
create policy "owner manages fee heads" on public.fee_heads
  for all to authenticated using (public.is_owner(school_id)) with check (public.is_owner(school_id));

drop policy "admins manage fee schedule" on public.fee_schedule;
create policy "admins read fee schedule" on public.fee_schedule
  for select to authenticated using (public.is_school_admin(school_id));
create policy "owner manages fee schedule" on public.fee_schedule
  for all to authenticated using (public.is_owner(school_id)) with check (public.is_owner(school_id));
