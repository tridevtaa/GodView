-- Class 12 finishes school: when a new session is created, that year's Class 12
-- students come along as inactive, in the same class, instead of disappearing.
-- Owners and admins can change them back (someone repeating the year).
--
-- is_graduate(): was this student in Class 12 in the session before this one?
-- carry_graduates (new session): adds those active that year to it as inactive.
-- keep_graduates_inactive (new enrolment): an import listing one as active
--   doesn't bring them back, and doesn't undo an admin's choice either.
-- generate_invoices: same as before, but doesn't bill those still inactive.

create function public.is_graduate(p_student uuid, p_session uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.academic_sessions cur
    join public.academic_sessions prev on prev.school_id = cur.school_id and prev.starts_on = (
      select max(p.starts_on) from public.academic_sessions p
      where p.school_id = cur.school_id and p.starts_on < cur.starts_on
    )
    join public.student_enrolments e on e.session_id = prev.id
    where cur.id = p_session and e.student_id = p_student and e.class = '12' and e.status <> 'left'
  )
$$;

create function public.carry_graduates() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  prev uuid;
begin
  select p.id into prev from public.academic_sessions p
  where p.school_id = new.school_id and p.starts_on < new.starts_on
  order by p.starts_on desc limit 1;
  if prev is null then
    return null;
  end if;

  insert into public.student_enrolments (student_id, session_id, school_id, class, section, stream, roll_no, status)
  select e.student_id, new.id, e.school_id, e.class, e.section, e.stream, e.roll_no, 'inactive'
  from public.student_enrolments e
  -- Active only, or last year's graduates would come along again every year
  where e.session_id = prev and e.class = '12' and e.status = 'active'
  on conflict (student_id, session_id) do nothing;

  update public.students s set status = 'inactive'
  from public.student_enrolments e
  where e.session_id = new.id and e.student_id = s.id and e.status = 'inactive' and s.status = 'active';
  return null;
end
$$;

create trigger academic_sessions_carry_graduates after insert on public.academic_sessions
  for each row execute function public.carry_graduates();

create function public.keep_graduates_inactive() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'active' and public.is_graduate(new.student_id, new.session_id) then
    new.status := coalesce(
      (select e.status from public.student_enrolments e where e.student_id = new.student_id and e.session_id = new.session_id),
      'inactive'
    );
  end if;
  return new;
end
$$;

create trigger student_enrolments_keep_graduates before insert on public.student_enrolments
  for each row execute function public.keep_graduates_inactive();

revoke execute on function public.is_graduate(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.carry_graduates() from public, anon, authenticated;
revoke execute on function public.keep_graduates_inactive() from public, anon, authenticated;

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
          -- Class 12 of the session before, still inactive: they've finished
          and not (e.status = 'inactive' and public.is_graduate(e.student_id, session))
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
