-- Putting a student on the bus (or moving them to another stop) creates
-- their transport dues straight away, from whichever screen saves it (the
-- student's profile, a route's stop, an import). Before, the dues only came
-- when someone pressed "Create dues" in Fee structure.
--
-- Which dues: the stop's fee lines in the current session, if the student is
-- active in it, from this month on. Months before they joined aren't charged.
-- Moving stops: their unpaid transport dues from this month on (nothing paid
-- against them, no concession) are replaced at the new stop's amounts. Paid
-- ones stay as they are.
-- Leaving the bus changes no dues; remove them from the student's Fees tab.
--
-- The months and labels follow generate_invoices exactly (same plan, period
-- and label rules), so pressing "Create dues" later doesn't add duplicates.

create function public.create_transport_dues(p_student uuid) returns int
language plpgsql security definer set search_path = '' as $$
declare
  priv public.student_private;
  ses public.academic_sessions;
  start_year int;
  line record;
  plan public.fee_plans;
  months_due date[];
  due_on date[];
  k int;
  steps int;
  step_months int;
  m date;
  per text;
  lbl text;
  this_month date := date_trunc('month', current_date)::date;
  inserted int := 0;
  n int;
begin
  select * into priv from public.student_private where student_id = p_student;
  if priv.student_id is null or not priv.uses_bus or priv.bus_stop_id is null then
    return 0;
  end if;
  select * into ses from public.academic_sessions where id = public.current_session(priv.school_id);
  if ses.id is null or not exists (
    select 1 from public.student_enrolments e where e.student_id = p_student and e.session_id = ses.id and e.status = 'active'
  ) then
    return 0;
  end if;
  start_year := coalesce(extract(year from ses.starts_on)::int, split_part(ses.name, '-', 1)::int);

  for line in
    select f.* from public.fee_schedule f where f.session_id = ses.id and f.stop_id = priv.bus_stop_id
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
      continue when m < this_month; -- before they joined
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
      insert into public.fee_invoices (school_id, session_id, student_id, head_id, period, label, amount, due_date)
      values (ses.school_id, ses.id, p_student, line.head_id, per, lbl, line.amount, due_on[k])
      on conflict (student_id, session_id, head_id, period) do nothing;
      get diagnostics n = row_count;
      inserted := inserted + n;
    end loop;
  end loop;
  return inserted;
end
$$;
revoke execute on function public.create_transport_dues(uuid) from public, anon, authenticated;

create function public.student_private_transport_dues() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  was_stop uuid := case when tg_op = 'UPDATE' and old.uses_bus then old.bus_stop_id end;
  now_stop uuid := case when new.uses_bus then new.bus_stop_id end;
  ses uuid;
begin
  if now_stop is null or now_stop is not distinct from was_stop then
    return null;
  end if;
  -- A move from another stop: clear the old stop's unpaid dues from this month on
  if was_stop is not null then
    ses := public.current_session(new.school_id);
    delete from public.fee_invoices i
    where i.student_id = new.student_id and i.session_id = ses
      and i.due_date >= date_trunc('month', current_date)::date
      and coalesce(i.concession, 0) = 0
      and i.head_id in (select f.head_id from public.fee_schedule f where f.session_id = ses and f.stop_id is not null)
      and not exists (select 1 from public.fee_allocations a where a.invoice_id = i.id);
  end if;
  perform public.create_transport_dues(new.student_id);
  return null;
end
$$;
revoke execute on function public.student_private_transport_dues() from public, anon, authenticated;

create trigger student_private_transport_dues after insert or update of uses_bus, bus_stop_id on public.student_private
  for each row execute function public.student_private_transport_dues();
