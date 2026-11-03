-- generate_invoices: only active students are billed. Dues already raised stay.
--
-- Graduates' parents lose the app once the new session has started, not when
-- it's created (that can be months early, with the child still in Class 12).
-- Their link to that child is marked removed, which everything parents can
-- reach already respects (sign-in, dues, messages, notices, notifications).
-- Links to their other children stay. Making the student active again restores
-- only the links ended this way, not ones the school removed itself.
--
-- Last session's Class 12 come into this session as inactive, as they would
-- have if carry_graduates had existed then.

alter table public.guardian_students add column ended_by_graduation boolean not null default false;
alter table public.academic_sessions add column graduates_ended_at timestamptz;

create function public.session_started(p_session uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.academic_sessions a
    where a.id = p_session and a.starts_on <= (now() at time zone 'Asia/Kolkata')::date
  )
$$;

-- Runs daily, and once per session: a parent added by hand afterwards stays.
create function public.end_graduate_links() returns void
language plpgsql security definer set search_path = '' as $$
declare
  sess uuid;
begin
  for sess in
    select a.id from public.academic_sessions a
    where a.graduates_ended_at is null and public.session_started(a.id)
  loop
    update public.guardian_students g set removed = true, ended_by_graduation = true
    from public.student_enrolments e
    where e.session_id = sess and e.student_id = g.student_id and e.status = 'inactive'
      and not g.removed and public.is_graduate(e.student_id, sess);
    update public.academic_sessions set graduates_ended_at = now() where id = sess;
  end loop;
end
$$;

-- The switch on a graduate's profile, once their new session has started
create function public.sync_graduate_parents() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_graduate(new.student_id, new.session_id) then
    return null;
  end if;
  if new.status = 'inactive' and public.session_started(new.session_id) then
    update public.guardian_students set removed = true, ended_by_graduation = true
    where student_id = new.student_id and not removed;
  elsif new.status = 'active' then
    update public.guardian_students set removed = false, ended_by_graduation = false
    where student_id = new.student_id and ended_by_graduation;
  end if;
  return null;
end
$$;

create trigger student_enrolments_graduate_parents after insert or update of status on public.student_enrolments
  for each row execute function public.sync_graduate_parents();

-- A new number on a graduate's record (an import, say) doesn't bring a parent
-- back. Adding one by hand on their profile does: the school chose that.
create function public.keep_graduate_links_ended() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.source = 'auto' and exists (
    select 1 from public.student_enrolments e
    where e.student_id = new.student_id and e.status = 'inactive'
      and e.session_id = public.current_session(new.school_id)
      and public.session_started(e.session_id) and public.is_graduate(e.student_id, e.session_id)
  ) then
    new.removed := true;
    new.ended_by_graduation := true;
  end if;
  return new;
end
$$;

create trigger guardian_students_keep_ended before insert on public.guardian_students
  for each row execute function public.keep_graduate_links_ended();

-- Re-added by hand: if it's removed again later, that's the school's removal
create function public.clear_graduation_flag() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.ended_by_graduation := false;
  return new;
end
$$;

create trigger guardian_students_clear_flag before update of removed on public.guardian_students
  for each row when (old.removed and not new.removed) execute function public.clear_graduation_flag();

revoke execute on function public.session_started(uuid) from public, anon, authenticated;
revoke execute on function public.end_graduate_links() from public, anon, authenticated;
revoke execute on function public.sync_graduate_parents() from public, anon, authenticated;
revoke execute on function public.keep_graduate_links_ended() from public, anon, authenticated;
revoke execute on function public.clear_graduation_flag() from public, anon, authenticated;

-- 00:15 IST (times are UTC)
select cron.schedule('end-graduate-links', '45 18 * * *', $$select public.end_graduate_links()$$);

-- Past sessions are done with; only the current one is caught up below
update public.academic_sessions set graduates_ended_at = now() where id <> public.current_session(school_id);

insert into public.student_enrolments (student_id, session_id, school_id, class, section, stream, roll_no, status)
select e.student_id, cur.id, e.school_id, e.class, e.section, e.stream, e.roll_no, 'inactive'
from public.academic_sessions cur
join public.academic_sessions prev on prev.school_id = cur.school_id and prev.starts_on = (
  select max(p.starts_on) from public.academic_sessions p
  where p.school_id = cur.school_id and p.starts_on < cur.starts_on
)
join public.student_enrolments e on e.session_id = prev.id
where cur.id = public.current_session(cur.school_id) and e.class = '12' and e.status = 'active'
on conflict (student_id, session_id) do nothing;

update public.students s set status = 'inactive'
from public.student_enrolments e
where e.student_id = s.id and s.status = 'active' and e.status = 'inactive'
  and e.session_id = public.current_session(s.school_id) and public.is_graduate(s.id, e.session_id);

select public.end_graduate_links();

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
