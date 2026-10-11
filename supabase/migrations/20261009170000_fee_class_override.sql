-- A fee amount set for a specific class now replaces the "all classes"
-- amount for that fee head when dues are generated (previously both could
-- apply and whichever ran first won).

-- Creates the dues for a session from its fee schedule for every student
-- enrolled (and not left). Safe to run again: existing dues are kept.
create or replace function public.generate_invoices(session uuid) returns int
language plpgsql security definer set search_path = '' as $$
declare
  ses public.academic_sessions;
  start_year int;
  line record;
  enr record;
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
    select f.*, h.name as head_name from public.fee_schedule f
    join public.fee_heads h on h.id = f.head_id
    where f.session_id = session
  loop
    steps := case line.frequency when 'monthly' then 12 when 'quarterly' then 4 when 'half_yearly' then 2 else 1 end;
    step_months := 12 / steps;
    for k in 0 .. steps - 1 loop
      -- Months from April run into the next calendar year (Apr 2026 … Mar 2027).
      m := make_date(start_year + case when line.start_month < 4 then 1 else 0 end, line.start_month, 1)
           + make_interval(months => k * step_months);
      per := case line.frequency
        when 'monthly' then to_char(m, 'YYYY-MM')
        when 'quarterly' then 'Q' || (k + 1)
        when 'half_yearly' then 'H' || (k + 1)
        when 'annual' then 'annual'
        else 'one-time'
      end;
      lbl := case line.frequency
        when 'monthly' then to_char(m, 'Mon YYYY')
        when 'quarterly' then 'Quarter ' || (k + 1)
        when 'half_yearly' then 'Half-year ' || (k + 1)
        when 'annual' then 'Annual'
        else 'One-time'
      end;
      for enr in
        select e.student_id from public.student_enrolments e
        where e.session_id = session and e.status <> 'left'
          and (line.class is null or e.class = line.class)
          -- An amount set for a specific class replaces the all-classes one.
          and not (line.class is null and exists (
            select 1 from public.fee_schedule o
            where o.session_id = session and o.head_id = line.head_id and o.class = e.class
          ))
      loop
        insert into public.fee_invoices (school_id, session_id, student_id, head_id, period, label, amount, due_date)
        values (ses.school_id, session, enr.student_id, line.head_id, per, lbl, line.amount,
                m + (line.due_day - 1))
        on conflict (student_id, session_id, head_id, period) do nothing;
        get diagnostics n = row_count;
        inserted := inserted + n;
      end loop;
    end loop;
  end loop;
  return inserted;
end
$$;
