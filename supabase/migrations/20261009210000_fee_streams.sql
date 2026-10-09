-- Fees by stream, and instalments due earlier than their month.
--
-- fee_schedule.streams: null = every stream; otherwise the line applies
-- only to students whose stream is in the list (e.g. 11th Arts at one
-- amount, 11th Commerce and Non Medical at another).
--
-- fee_plans.due_months: optional, same length as months; the month each
-- instalment falls due (e.g. June's fee due with May's).
--
-- For a student and a fee, the most specific matching line wins:
-- class and stream, then class, then every class.

alter table public.fee_schedule add column streams text[]
  check (streams is null or cardinality(streams) between 1 and 10);

drop index public.fee_schedule_unique;
create unique index fee_schedule_unique
  on public.fee_schedule (session_id, coalesce(class, ''), head_id, coalesce(streams, '{}'::text[]));

alter table public.fee_plans add column due_months int[]
  check (due_months is null or (cardinality(due_months) = cardinality(months)
         and due_months <@ array[1,2,3,4,5,6,7,8,9,10,11,12]));

-- Does a fee line apply to a student in this class and stream?
create function public.fee_line_matches(line_class text, line_streams text[], e_class text, e_stream text)
returns boolean language sql immutable set search_path = '' as $$
  select (line_class is null or line_class = e_class)
     and (line_streams is null or exists (
           select 1 from unnest(line_streams) s where lower(trim(s)) = lower(trim(coalesce(e_stream, '')))))
$$;

create function public.fee_line_rank(line_class text, line_streams text[])
returns int language sql immutable set search_path = '' as $$
  select case when line_class is null then 0 when line_streams is null then 1 else 2 end
$$;

create or replace function public.generate_invoices(session uuid) returns int
language plpgsql security definer set search_path = '' as $$
declare
  ses public.academic_sessions;
  start_year int;
  line record;
  enr record;
  plan public.fee_plans;
  months_due date[];
  due_on date[];
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
    due_on := '{}';
    if line.plan_id is not null then
      select * into plan from public.fee_plans where id = line.plan_id;
      for k in 1 .. cardinality(plan.months) loop
        months_due := months_due || make_date(start_year + case when plan.months[k] < 4 then 1 else 0 end, plan.months[k], 1);
        due_on := due_on || make_date(
          start_year + case when coalesce(plan.due_months[k], plan.months[k]) < 4 then 1 else 0 end,
          coalesce(plan.due_months[k], plan.months[k]), 1) + (plan.due_day - 1);
      end loop;
    else
      plan := null;
      steps := case line.frequency when 'monthly' then 12 when 'quarterly' then 4 when 'half_yearly' then 2 else 1 end;
      step_months := 12 / steps;
      for k in 0 .. steps - 1 loop
        m := (make_date(start_year + case when line.start_month < 4 then 1 else 0 end, line.start_month, 1)
          + make_interval(months => k * step_months))::date;
        months_due := months_due || m;
        due_on := due_on || (m + (line.due_day - 1));
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
          and public.fee_line_matches(line.class, line.streams, e.class, e.stream)
          and not exists (
            select 1 from public.fee_schedule o
            where o.session_id = session and o.head_id = line.head_id and o.id <> line.id
              and public.fee_line_rank(o.class, o.streams) > public.fee_line_rank(line.class, line.streams)
              and public.fee_line_matches(o.class, o.streams, e.class, e.stream)
          )
      loop
        insert into public.fee_invoices (school_id, session_id, student_id, head_id, period, label, amount, due_date)
        values (ses.school_id, session, enr.student_id, line.head_id, per, lbl, line.amount, due_on[k])
        on conflict (student_id, session_id, head_id, period) do nothing;
        get diagnostics n = row_count;
        inserted := inserted + n;
      end loop;
    end loop;
  end loop;
  return inserted;
end
$$;
