-- Transport fee by bus stop: a fee line can be for a stop instead of a grade.
-- Schools price each place on a route (a far village costs more than a near
-- one on the same bus), so the amount is per stop.
--
-- fee_schedule.stop_id: set = the line is for students who use the bus from
-- that stop, whatever their grade. A fee head is either by grade or by stop,
-- never both; the app keeps it that way.
-- generate_invoices: same as before, plus stop lines.

alter table public.fee_schedule
  add column stop_id uuid,
  add constraint fee_schedule_stop_fk foreign key (stop_id, school_id)
    references public.bus_stops (id, school_id) on delete cascade,
  add constraint fee_schedule_stop_no_class check (stop_id is null or (class is null and streams is null));

drop index public.fee_schedule_unique;
create unique index fee_schedule_unique
  on public.fee_schedule (session_id, coalesce(class, ''), head_id, coalesce(streams, '{}'::text[]), coalesce(stop_id::text, ''));

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
