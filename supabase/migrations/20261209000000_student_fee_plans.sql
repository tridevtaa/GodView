-- 1. A payment plan per student: some families pay monthly, some quarterly,
--    some once a year. The fee structure still sets what each grade (or bus
--    stop) pays in a year; a student's own plan only changes how that year is
--    split into instalments.
-- 2. Admins can change the fee structure, with each change waiting for the
--    owner's approval.
--
-- student_enrolments.fee_plan_id: the student's plan for that session; null
--   follows the fee structure. It applies to recurring fees (billed more than
--   once a year, e.g. tuition, transport). One-time and annual fees stay as
--   they are.
-- fee_instalments(): one fee line's instalments (month, period, label,
--   amount, due date) for a student, on the line's own plan or the
--   student's. generate_invoices() and create_transport_dues() both use it,
--   so the rules live in one place.
--   On a student's own plan the year's total (instalment amount x the
--   fee's instalments) is split evenly across their plan's instalments, in
--   whole rupees, the last one taking what's left. Labels name the months
--   each instalment covers, e.g. "Apr–Jun 2026".
-- set_student_fee_plan(): sets the plan and regroups the dues already made:
--   for each recurring fee, dues with a payment or a concession stay; the
--   rest of what the student is billed for that fee is regrouped into the
--   new plan's instalments that come after them. The total billed doesn't
--   change.
-- generate_invoices(): a student on their own plan who already has dues for
--   a fee isn't given more for it (set_student_fee_plan made them).
-- Quarterly (Apr, Jul, Oct, Jan) becomes a standard plan for every school.
-- fee_structure_requests: an admin's change to one fee (a whole fee card, or
--   removing the fee), waiting for the owner. The owner's app applies an
--   approved change exactly as if the owner had saved it.

-- ------------------------------------------------ the student's own plan ---

alter table public.student_enrolments
  add column fee_plan_id uuid,
  add constraint student_enrolments_fee_plan_fk foreign key (fee_plan_id, school_id)
    references public.fee_plans (id, school_id) on delete set null (fee_plan_id);

-- Quarterly for every school (and new ones)
insert into public.fee_plans (school_id, name, months, is_standard, sort)
select s.id, 'Quarterly', array[4, 7, 10, 1], true, 2 from public.schools s
on conflict (school_id, name) do nothing;

create or replace function public.seed_fee_plans(school uuid) returns void
language sql security definer set search_path = '' as $$
  insert into public.fee_plans (school_id, name, months, is_standard, sort) values
    (school, 'Monthly', array[4,5,6,7,8,9,10,11,12,1,2,3], true, 1),
    (school, 'Quarterly', array[4,7,10,1], true, 2),
    (school, 'Bi-annually', array[4,10], true, 3),
    (school, 'One time', array[4], true, 4)
  on conflict (school_id, name) do nothing
$$;
revoke execute on function public.seed_fee_plans(uuid) from public, anon, authenticated;

-- ------------------------------------------------------- instalments ---

-- The months a due covers: "Apr 2026", "Apr–Jun 2026", "Oct 2026–Mar 2027".
create function public.fee_span_label(p_from date, p_to date) returns text
language sql immutable set search_path = '' as $$
  select case
    when p_to <= p_from then to_char(p_from, 'Mon YYYY')
    when extract(year from p_to) = extract(year from p_from) then to_char(p_from, 'Mon') || '–' || to_char(p_to, 'Mon YYYY')
    else to_char(p_from, 'Mon YYYY') || '–' || to_char(p_to, 'Mon YYYY')
  end
$$;

create function public.fee_instalments(p_line public.fee_schedule, p_plan uuid, p_start_year int)
returns table (inst_k int, inst_month date, inst_period text, inst_label text, inst_amount numeric, inst_due date)
language plpgsql stable security definer set search_path = '' as $$
declare
  own public.fee_plans;
  sp public.fee_plans;
  months_due date[] := '{}';
  due_on date[] := '{}';
  n int;
  i int;
  steps int;
  step_months int;
  m date;
  span_end date;
  session_end date := make_date(p_start_year + 1, 3, 1);
  total numeric;
  v_each numeric;
  per text;
  lbl text;
begin
  -- The fee's own instalments
  if p_line.plan_id is not null then
    select * into own from public.fee_plans where id = p_line.plan_id;
    for i in 1 .. cardinality(own.months) loop
      months_due := months_due || make_date(p_start_year + case when own.months[i] < 4 then 1 else 0 end, own.months[i], 1);
      due_on := due_on || make_date(
        p_start_year + case when coalesce(own.due_months[i], own.months[i]) < 4 then 1 else 0 end,
        coalesce(own.due_months[i], own.months[i]), 1) + (own.due_day - 1);
    end loop;
  else
    steps := case p_line.frequency when 'monthly' then 12 when 'quarterly' then 4 when 'half_yearly' then 2 else 1 end;
    step_months := 12 / steps;
    for i in 0 .. steps - 1 loop
      m := (make_date(p_start_year + case when p_line.start_month < 4 then 1 else 0 end, p_line.start_month, 1)
        + make_interval(months => i * step_months))::date;
      months_due := months_due || m;
      due_on := due_on || (m + (p_line.due_day - 1));
    end loop;
  end if;
  n := cardinality(months_due);

  -- The student's own plan: recurring fees only, the same total for the year
  if p_plan is not null and n > 1 and p_plan is distinct from p_line.plan_id then
    select * into sp from public.fee_plans where id = p_plan;
    if sp.id is not null then
      total := p_line.amount * n;
      months_due := '{}';
      due_on := '{}';
      for i in 1 .. cardinality(sp.months) loop
        months_due := months_due || make_date(p_start_year + case when sp.months[i] < 4 then 1 else 0 end, sp.months[i], 1);
        due_on := due_on || make_date(
          p_start_year + case when coalesce(sp.due_months[i], sp.months[i]) < 4 then 1 else 0 end,
          coalesce(sp.due_months[i], sp.months[i]), 1) + (sp.due_day - 1);
      end loop;
      steps := cardinality(months_due);
      v_each := floor(total / steps);
      for i in 1 .. steps loop
        m := months_due[i];
        -- The months it covers: up to the next instalment, or March
        span_end := coalesce((months_due[i + 1] - interval '1 month')::date, session_end);
        lbl := public.fee_span_label(m, span_end);
        return query select i, m, to_char(m, 'YYYY-MM'), lbl,
          case when i = steps then total - v_each * (steps - 1) else v_each end, due_on[i];
      end loop;
      return;
    end if;
  end if;

  for i in 1 .. n loop
    m := months_due[i];
    if p_line.plan_id is not null or p_line.frequency = 'monthly' then
      per := to_char(m, 'YYYY-MM');
      lbl := to_char(m, 'Mon YYYY');
    else
      per := case p_line.frequency
        when 'quarterly' then 'Q' || i
        when 'half_yearly' then 'H' || i
        when 'annual' then 'annual'
        else 'one-time'
      end;
      lbl := case p_line.frequency
        when 'quarterly' then 'Quarter ' || i
        when 'half_yearly' then 'Half-year ' || i
        when 'annual' then 'Annual'
        else 'One-time'
      end;
    end if;
    return query select i, m, per, lbl, p_line.amount, due_on[i];
  end loop;
end
$$;
revoke execute on function public.fee_instalments(public.fee_schedule, uuid, int) from public, anon, authenticated;

-- ---------------------------------------------------- generate_invoices ---

create or replace function public.generate_invoices(session uuid) returns int
language plpgsql security definer set search_path = '' as $$
declare
  ses public.academic_sessions;
  start_year int;
  line public.fee_schedule;
  inserted int := 0;
  n int;
begin
  select * into ses from public.academic_sessions where id = session;
  if ses.id is null or not public.can_wide(ses.school_id, 'fees', 2) then
    raise exception 'not allowed';
  end if;
  start_year := coalesce(extract(year from ses.starts_on)::int, split_part(ses.name, '-', 1)::int);

  for line in
    select f.* from public.fee_schedule f where f.session_id = session
  loop
    insert into public.fee_invoices (school_id, session_id, student_id, head_id, period, label, amount, due_date)
    select ses.school_id, session, e.student_id, line.head_id, i.inst_period, i.inst_label, i.inst_amount, i.inst_due
    from public.student_enrolments e
    cross join lateral public.fee_instalments(line, e.fee_plan_id, start_year) i
    where e.session_id = session and e.status = 'active'
      and case when line.stop_id is not null then
        -- On the bus from this stop
        exists (
          select 1 from public.student_private p
          where p.student_id = e.student_id and p.uses_bus and p.bus_stop_id = line.stop_id
        )
      else
        public.fee_line_matches(line.class, line.streams, e.class, e.stream)
        and not exists (
          select 1 from public.fee_schedule o
          where o.session_id = session and o.head_id = line.head_id and o.id <> line.id and o.stop_id is null
            and public.fee_line_rank(o.class, o.streams) > public.fee_line_rank(line.class, line.streams)
            and public.fee_line_matches(o.class, o.streams, e.class, e.stream)
        )
      end
      -- On their own plan with dues for this fee already: set_student_fee_plan made them
      and (e.fee_plan_id is null or not exists (
        select 1 from public.fee_invoices x
        where x.student_id = e.student_id and x.session_id = session and x.head_id = line.head_id and x.period <> 'opening'
      ))
    on conflict (student_id, session_id, head_id, period) do nothing;
    get diagnostics n = row_count;
    inserted := inserted + n;
  end loop;
  return inserted;
end
$$;

-- ------------------------------------------------ create_transport_dues ---

create or replace function public.create_transport_dues(p_student uuid) returns int
language plpgsql security definer set search_path = '' as $$
declare
  priv public.student_private;
  ses public.academic_sessions;
  enr public.student_enrolments;
  start_year int;
  line public.fee_schedule;
  this_month date := date_trunc('month', current_date)::date;
  inserted int := 0;
  n int;
begin
  select * into priv from public.student_private where student_id = p_student;
  if priv.student_id is null or not priv.uses_bus or priv.bus_stop_id is null then
    return 0;
  end if;
  select * into ses from public.academic_sessions where id = public.current_session(priv.school_id);
  select * into enr from public.student_enrolments e where e.student_id = p_student and e.session_id = ses.id and e.status = 'active';
  if ses.id is null or enr.student_id is null then
    return 0;
  end if;
  start_year := coalesce(extract(year from ses.starts_on)::int, split_part(ses.name, '-', 1)::int);

  for line in
    select f.* from public.fee_schedule f where f.session_id = ses.id and f.stop_id = priv.bus_stop_id
  loop
    insert into public.fee_invoices (school_id, session_id, student_id, head_id, period, label, amount, due_date)
    select ses.school_id, ses.id, p_student, line.head_id, i.inst_period, i.inst_label, i.inst_amount, i.inst_due
    from public.fee_instalments(line, enr.fee_plan_id, start_year) i
    where i.inst_month >= this_month -- before they joined
    on conflict (student_id, session_id, head_id, period) do nothing;
    get diagnostics n = row_count;
    inserted := inserted + n;
  end loop;
  return inserted;
end
$$;
revoke execute on function public.create_transport_dues(uuid) from public, anon, authenticated;

-- ------------------------------------------------- set_student_fee_plan ---

create function public.set_student_fee_plan(p_student uuid, p_session uuid, p_plan uuid) returns int
language plpgsql security definer set search_path = '' as $$
declare
  enr public.student_enrolments;
  ses public.academic_sessions;
  start_year int;
  h record;
  line public.fee_schedule;
  billed numeric;
  first_month date;
  kept_total numeric;
  kept_last date;
  rest numeric;
  v_months date[];
  periods text[];
  labels text[];
  dues date[];
  cnt int;
  v_each numeric;
  j int;
  made int := 0;
begin
  select * into enr from public.student_enrolments where student_id = p_student and session_id = p_session;
  if enr.student_id is null or not public.can_wide(enr.school_id, 'fees', 2) then
    raise exception 'not allowed';
  end if;
  if p_plan is not null and not exists (select 1 from public.fee_plans where id = p_plan and school_id = enr.school_id) then
    raise exception 'not allowed';
  end if;
  if enr.fee_plan_id is not distinct from p_plan then
    return 0;
  end if;
  update public.student_enrolments set fee_plan_id = p_plan where student_id = p_student and session_id = p_session;

  select * into ses from public.academic_sessions where id = p_session;
  start_year := coalesce(extract(year from ses.starts_on)::int, split_part(ses.name, '-', 1)::int);

  -- Each fee in the structure that the student already has dues for
  for h in
    select distinct i.head_id from public.fee_invoices i
    where i.student_id = p_student and i.session_id = p_session and i.period <> 'opening'
      and exists (select 1 from public.fee_schedule f where f.session_id = p_session and f.head_id = i.head_id)
  loop
    -- One fee has one frequency for all its lines, so any line tells it
    select f.* into line from public.fee_schedule f
    where f.session_id = p_session and f.head_id = h.head_id order by f.created_at limit 1;
    continue when (select count(*) from public.fee_instalments(line, null, start_year)) <= 1; -- not recurring

    select coalesce(sum(i.amount), 0), date_trunc('month', min(i.due_date))::date into billed, first_month
    from public.fee_invoices i
    where i.student_id = p_student and i.session_id = p_session and i.head_id = h.head_id and i.period <> 'opening';

    -- Paid (even in part) or with a concession: kept as they are
    select coalesce(sum(i.amount), 0), date_trunc('month', max(i.due_date))::date into kept_total, kept_last
    from public.fee_invoices i
    where i.student_id = p_student and i.session_id = p_session and i.head_id = h.head_id and i.period <> 'opening'
      and (i.concession > 0 or exists (select 1 from public.fee_allocations a where a.invoice_id = i.id));

    delete from public.fee_invoices i
    where i.student_id = p_student and i.session_id = p_session and i.head_id = h.head_id and i.period <> 'opening'
      and i.concession = 0 and not exists (select 1 from public.fee_allocations a where a.invoice_id = i.id);

    rest := billed - kept_total;
    continue when rest <= 0;

    -- The new plan's instalments from when this fee starts, after what's kept
    select array_agg(x.inst_month order by x.inst_k), array_agg(x.inst_period order by x.inst_k),
           array_agg(x.inst_label order by x.inst_k), array_agg(x.inst_due order by x.inst_k)
      into v_months, periods, labels, dues
    from public.fee_instalments(line, p_plan, start_year) x
    where x.inst_month >= coalesce(first_month, x.inst_month)
      and (kept_last is null or x.inst_month > kept_last);
    cnt := coalesce(cardinality(v_months), 0);

    if cnt = 0 then
      -- No instalment left in the year: what's left is due now
      insert into public.fee_invoices (school_id, session_id, student_id, head_id, period, label, amount, due_date)
      values (enr.school_id, p_session, p_student, h.head_id, 'bal-' || to_char(now(), 'YYMMDDHH24MISS'), 'Balance', rest, current_date);
      made := made + 1;
      continue;
    end if;

    -- The first one also covers the months since what's kept (or since the
    -- fee started), so its label says so: "Aug–Dec 2026"
    if coalesce((kept_last + interval '1 month')::date, first_month) < v_months[1] then
      labels[1] := public.fee_span_label(
        coalesce((kept_last + interval '1 month')::date, first_month),
        coalesce((v_months[2] - interval '1 month')::date, make_date(start_year + 1, 3, 1)));
    end if;

    v_each := floor(rest / cnt);
    for j in 1 .. cnt loop
      insert into public.fee_invoices (school_id, session_id, student_id, head_id, period, label, amount, due_date)
      values (enr.school_id, p_session, p_student, h.head_id, periods[j], labels[j],
              case when j = cnt then rest - v_each * (cnt - 1) else v_each end, dues[j])
      on conflict (student_id, session_id, head_id, period)
        do update set amount = public.fee_invoices.amount + excluded.amount;
      made := made + 1;
    end loop;
  end loop;
  return made;
end
$$;
revoke execute on function public.set_student_fee_plan(uuid, uuid, uuid) from public, anon;
grant execute on function public.set_student_fee_plan(uuid, uuid, uuid) to authenticated;

-- ------------------------------------------ admins' fee structure changes ---

create table public.fee_structure_requests (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  session_id uuid not null,
  head_id uuid references public.fee_heads (id) on delete cascade, -- null: a new fee
  kind text not null check (kind in ('save', 'remove')),
  fee_name text not null check (length(fee_name) between 1 and 60),
  payload jsonb not null default '{}'::jsonb, -- the fee card as the admin saved it
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'withdrawn')),
  requested_by text,
  requested_at timestamptz not null default now(),
  decided_by text,
  decided_at timestamptz,
  note text check (length(note) <= 300),
  foreign key (session_id, school_id) references public.academic_sessions (id, school_id) on delete cascade
);
create index fee_structure_requests_open on public.fee_structure_requests (school_id, session_id) where status = 'pending';

grant select on public.fee_structure_requests to authenticated;
alter table public.fee_structure_requests enable row level security;
create policy "fees viewers read fee structure requests" on public.fee_structure_requests
  for select to authenticated using (public.can_wide(school_id, 'fees', 1));

-- An admin's change to one fee. A newer change to the same fee by the same
-- person replaces their earlier one that's still waiting.
create function public.request_fee_structure_change(p_session uuid, p_head uuid, p_kind text, p_name text, p_payload jsonb)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_school uuid;
  v_id uuid;
begin
  select school_id into v_school from public.academic_sessions where id = p_session;
  if v_school is null or not public.can_wide(v_school, 'fees', 2) then
    raise exception 'not allowed';
  end if;
  if p_head is not null and not exists (select 1 from public.fee_heads where id = p_head and school_id = v_school) then
    raise exception 'not allowed';
  end if;
  if p_kind = 'remove' and p_head is null then
    raise exception 'not allowed';
  end if;
  update public.fee_structure_requests
     set status = 'withdrawn', decided_by = public.current_email(), decided_at = now()
   where school_id = v_school and session_id = p_session and status = 'pending'
     and requested_by = public.current_email()
     and (head_id = p_head or (p_head is null and head_id is null and lower(fee_name) = lower(trim(p_name))));
  insert into public.fee_structure_requests (school_id, session_id, head_id, kind, fee_name, payload, requested_by)
  values (v_school, p_session, p_head, p_kind, left(trim(p_name), 60), coalesce(p_payload, '{}'::jsonb), public.current_email())
  returning id into v_id;
  return v_id;
end
$$;
revoke execute on function public.request_fee_structure_change(uuid, uuid, text, text, jsonb) from public, anon;
grant execute on function public.request_fee_structure_change(uuid, uuid, text, text, jsonb) to authenticated;

-- The owner approves (after their app has applied it) or rejects; whoever
-- asked can withdraw it while it waits.
create function public.decide_fee_structure_request(p_id uuid, p_status text, p_note text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  r public.fee_structure_requests;
begin
  select * into r from public.fee_structure_requests where id = p_id and status = 'pending';
  if r.id is null
     or p_status not in ('approved', 'rejected', 'withdrawn')
     or (p_status = 'withdrawn' and r.requested_by is distinct from public.current_email() and not public.is_owner(r.school_id))
     or (p_status <> 'withdrawn' and not public.is_owner(r.school_id)) then
    raise exception 'not allowed';
  end if;
  update public.fee_structure_requests
     set status = p_status, decided_by = public.current_email(), decided_at = now(), note = left(nullif(trim(p_note), ''), 300)
   where id = p_id;
end
$$;
revoke execute on function public.decide_fee_structure_request(uuid, text, text) from public, anon;
grant execute on function public.decide_fee_structure_request(uuid, text, text) to authenticated;
