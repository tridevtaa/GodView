-- Everyday notifications, sent on their own (IST, school days only: not
-- Sundays, not holidays on the school's calendar):
--   08:00 todo              staff: what's waiting on them (unread messages,
--                           requests to answer, people waiting for app access)
--   08:30 attendance        class teachers whose class isn't marked yet
--   10:30 attendance-leads  owner, admins, principal: classes still not marked
--   11:00 absent            parents: their child was marked absent today
--   18:00 tomorrow          everyone: tomorrow's holidays, exams, events
--                           (parents only those meant for them)
--   19:00 homework          parents: homework due tomorrow
--   Mon 10:00 fees          parents: fees overdue (15+ days)
-- pg_cron calls the push-message function with { slot }; it asks
-- daily_push() who gets what, and sends. Each slot runs once a day, and
-- only around its time.

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

-- ------------------------------------------------------------- helpers ---

-- Today in India.
create function public.ist_today() returns date
language sql stable set search_path = '' as $$
  select (now() at time zone 'Asia/Kolkata')::date
$$;

-- Not a Sunday, and not a holiday on the school's calendar.
create function public.is_school_day(school uuid, d date) returns boolean
language sql stable security definer set search_path = '' as $$
  select extract(isodow from d) <> 7 and not exists (
    select 1 from public.calendar_events c
    where c.school_id = school and c.kind = 'holiday'
      and c.starts_on <= d and coalesce(c.ends_on, c.starts_on) >= d
  )
$$;

-- The school's current (latest) session.
create function public.current_session(school uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select a.id from public.academic_sessions a where a.school_id = school order by a.name desc limit 1
$$;

-- "Class 5 A", "KG 1".
create function public.class_text(klass text, sec text) returns text
language sql immutable set search_path = '' as $$
  select case when klass ~ '^\d+$' then 'Class ' || klass else klass end || coalesce(' ' || nullif(sec, ''), '')
$$;

-- Devices with notifications on: staff by email, parents by phone.
create function public.staff_devices() returns table (email text, endpoint text, p256dh text, auth text)
language sql stable security definer set search_path = '' as $$
  select lower(u.email), p.endpoint, p.p256dh, p.auth
  from public.push_subscriptions p join auth.users u on u.id = p.user_id
  where u.email_confirmed_at is not null
$$;

create function public.parent_devices() returns table (phone text, endpoint text, p256dh text, auth text)
language sql stable security definer set search_path = '' as $$
  select public.normalise_phone(u.phone), p.endpoint, p.p256dh, p.auth
  from public.push_subscriptions p join auth.users u on u.id = p.user_id
  where u.phone_confirmed_at is not null
$$;

-- Classes with no attendance marked at all on a day (current session).
create function public.unmarked_classes(d date) returns table (school_id uuid, session_id uuid, class text, section text)
language sql stable security definer set search_path = '' as $$
  select e.school_id, e.session_id, e.class, coalesce(e.section, '')
  from public.student_enrolments e
  left join public.attendance a on a.student_id = e.student_id and a.day = d
  where e.status <> 'left' and e.session_id = public.current_session(e.school_id)
  group by e.school_id, e.session_id, e.class, coalesce(e.section, '')
  having count(a.student_id) = 0
$$;

-- A student's parents' devices (one row per device).
create function public.student_parent_devices(student uuid) returns table (endpoint text, p256dh text, auth text)
language sql stable security definer set search_path = '' as $$
  select distinct s.endpoint, s.p256dh, s.auth
  from public.guardian_students gs
  join public.guardians g on g.id = gs.guardian_id
  join public.parent_devices() s on s.phone = g.phone
  where gs.student_id = student and not gs.removed
$$;

-- Each slot once a day.
create table public.push_runs (
  slot text not null,
  day date not null,
  ran_at timestamptz not null default now(),
  primary key (slot, day)
);

alter table public.push_runs enable row level security; -- no policies: server only

-- ----------------------------------------------------------- the slots ---

create function public.daily_push(p_slot text)
returns table (sub_endpoint text, sub_p256dh text, sub_auth text, title text, body text, url text)
language plpgsql security definer set search_path = '' as $$
declare
  d date := public.ist_today();
  t time := (now() at time zone 'Asia/Kolkata')::time;
begin
  -- Only around its time, so a call at any other time can't use it up.
  if not (
    (p_slot = 'todo' and t between '07:55' and '10:00')
    or (p_slot = 'attendance' and t between '08:25' and '10:00')
    or (p_slot = 'attendance-leads' and t between '10:25' and '12:00')
    or (p_slot = 'absent' and t between '10:55' and '13:00')
    or (p_slot = 'tomorrow' and t between '17:55' and '20:00')
    or (p_slot = 'homework' and t between '18:55' and '21:00')
    or (p_slot = 'fees' and t between '09:55' and '12:00' and extract(isodow from d) = 1)
  ) then
    return;
  end if;
  insert into public.push_runs (slot, day) values (p_slot, d) on conflict do nothing;
  if not found then
    return;
  end if;

  if p_slot = 'attendance' then
    return query
    with todo as (
      select tc.email, count(*) as n,
        string_agg(public.class_text(c.class, c.section), ', ' order by c.class, c.section) as list
      from public.unmarked_classes(d) c
      join public.teacher_classes tc
        on tc.school_id = c.school_id and tc.session_id = c.session_id and tc.is_class_teacher
       and tc.class = c.class and (tc.section is null or tc.section = c.section)
      where public.is_school_day(c.school_id, d)
      group by tc.email
    )
    -- The classes by name, up to three; past that, how many.
    select s.endpoint, s.p256dh, s.auth, 'Attendance'::text,
      'Mark attendance for ' || case when x.n <= 3 then x.list else x.n || ' classes' end,
      '/?go=attendance'
    from todo x join public.staff_devices() s on s.email = x.email;

  elsif p_slot = 'attendance-leads' then
    return query
    with left_over as (
      select c.school_id, count(*) as n, string_agg(public.class_text(c.class, c.section), ', ' order by c.class, c.section) as list
      from public.unmarked_classes(d) c
      where public.is_school_day(c.school_id, d)
      group by c.school_id
    )
    select s.endpoint, s.p256dh, s.auth, 'Attendance'::text,
      x.n || case when x.n = 1 then ' class' else ' classes' end || ' still not marked'
        || case when x.n <= 3 then ': ' || x.list else '' end,
      '/?go=attendance'
    from left_over x
    join public.school_members m on m.school_id = x.school_id and m.role::text in ('owner', 'admin', 'principal')
    join public.staff_devices() s on s.email = m.email;

  elsif p_slot = 'todo' then
    return query
    with staff as (
      select m.school_id, m.email, m.role::text as role
      from public.school_members m
      where public.is_school_day(m.school_id, d)
    ),
    sees as (
      select st.school_id, st.email, s.id as student_id
      from staff st join public.students s on s.school_id = st.school_id
      where st.role in ('owner', 'admin', 'principal')
      union
      select st.school_id, st.email, e.student_id
      from staff st
      join public.teacher_classes tc
        on tc.school_id = st.school_id and tc.email = st.email and tc.session_id = public.current_session(st.school_id)
      join public.student_enrolments e
        on e.session_id = tc.session_id and e.class = tc.class and (tc.section is null or tc.section = e.section) and e.status <> 'left'
      where st.role = 'teacher'
    ),
    counts as (
      select st.email,
        (
          select count(*) from sees x
          where x.school_id = st.school_id and x.email = st.email
            and exists (
              select 1 from public.messages m
              where m.student_id = x.student_id and m.from_parent and m.created_at > now() - interval '30 days'
                and m.created_at > coalesce((
                  select r.seen_at from public.message_reads r where r.student_id = x.student_id and r.reader = st.email
                ), '-infinity')
            )
        ) as unread,
        (
          select count(*) from public.parent_requests q
          join sees x on x.student_id = q.student_id and x.email = st.email and x.school_id = st.school_id
          where q.status = 'open'
        ) as requests,
        case when st.role = 'owner' then (
          select count(*) from public.access_requests a where a.school_id = st.school_id and a.status = 'pending'
        ) else 0 end as access
      from staff st
    )
    select s.endpoint, s.p256dh, s.auth, 'Waiting for you today'::text,
      concat_ws(' · ',
        case when c.unread > 0 then c.unread || ' unread ' || case when c.unread = 1 then 'message' else 'messages' end end,
        case when c.requests > 0 then c.requests || case when c.requests = 1 then ' request' else ' requests' end || ' to answer' end,
        case when c.access > 0 then c.access || ' waiting for app access' end),
      case when c.unread + c.requests > 0 then '/?go=requests' else '/?go=access' end
    from counts c join public.staff_devices() s on s.email = c.email
    where c.unread + c.requests + c.access > 0;

  elsif p_slot = 'absent' then
    return query
    select p.endpoint, p.p256dh, p.auth, 'Attendance'::text,
      split_part(trim(st.name), ' ', 1) || ' was marked absent today', '/?thread=' || a.student_id
    from public.attendance a
    join public.students st on st.id = a.student_id
    cross join lateral public.student_parent_devices(a.student_id) p
    where a.day = d and a.status = 'absent' and public.is_school_day(a.school_id, d);

  elsif p_slot = 'homework' then
    return query
    with due as (
      select e.student_id,
        string_agg(distinct coalesce(nullif(trim(h.subject), ''), 'Homework'), ', ') as subjects
      from public.student_enrolments e
      join public.homework h
        on h.session_id = e.session_id and h.class = e.class and (h.section is null or h.section = e.section)
      where e.status <> 'left' and e.session_id = public.current_session(e.school_id) and h.due_date = d + 1
        and (
          not exists (select 1 from public.homework_students x where x.homework_id = h.id)
          or exists (select 1 from public.homework_students x where x.homework_id = h.id and x.student_id = e.student_id)
        )
      group by e.student_id
    )
    select p.endpoint, p.p256dh, p.auth, 'Homework'::text,
      'Due tomorrow for ' || split_part(trim(st.name), ' ', 1) || ': ' || u.subjects,
      '/?go=homework&child=' || u.student_id
    from due u
    join public.students st on st.id = u.student_id
    cross join lateral public.student_parent_devices(u.student_id) p;

  elsif p_slot = 'tomorrow' then
    return query
    with items as (
      select c.school_id, c.title, c.for_parents from public.calendar_events c where c.starts_on = d + 1
      union all
      select n.school_id, n.title, n.for_parents from public.notices n where n.event_on = d + 1
    ),
    for_staff as (
      select i.school_id, string_agg(i.title, ' · ') as list from items i group by i.school_id
    ),
    for_parents as (
      select i.school_id, string_agg(i.title, ' · ') as list from items i where i.for_parents group by i.school_id
    ),
    parents as (
      select distinct gs.school_id, g.phone
      from public.guardian_students gs join public.guardians g on g.id = gs.guardian_id
      where not gs.removed
    )
    select s.endpoint, s.p256dh, s.auth, 'Tomorrow'::text, left(x.list, 180), '/?go=calendar'
    from for_staff x
    join public.school_members m on m.school_id = x.school_id
    join public.staff_devices() s on s.email = m.email
    union all
    select s.endpoint, s.p256dh, s.auth, 'Tomorrow'::text, left(x.list, 180), '/?go=calendar'
    from for_parents x
    join parents pa on pa.school_id = x.school_id
    join public.parent_devices() s on s.phone = pa.phone;

  elsif p_slot = 'fees' then
    return query
    with owed as (
      select b.student_id, sum(b.balance) as amount
      from public.fee_invoice_balances b
      where b.balance > 0.009 and b.due_date < d - 15
      group by b.student_id
    )
    select p.endpoint, p.p256dh, p.auth, 'Fees'::text,
      '₹' || to_char(round(o.amount), 'FM99,99,99,999') || ' fees overdue for ' || split_part(trim(st.name), ' ', 1),
      '/?go=fees&child=' || o.student_id
    from owed o
    join public.students st on st.id = o.student_id
    cross join lateral public.student_parent_devices(o.student_id) p;
  end if;
end
$$;

revoke execute on function public.is_school_day(uuid, date) from public, anon, authenticated;
revoke execute on function public.current_session(uuid) from public, anon, authenticated;
revoke execute on function public.staff_devices() from public, anon, authenticated;
revoke execute on function public.parent_devices() from public, anon, authenticated;
revoke execute on function public.unmarked_classes(date) from public, anon, authenticated;
revoke execute on function public.student_parent_devices(uuid) from public, anon, authenticated;
revoke execute on function public.daily_push(text) from public, anon, authenticated;
grant execute on function public.daily_push(text) to service_role;

-- ----------------------------------------------------------- schedules ---

-- Times are UTC (IST minus 5:30). The key is the project's publishable key
-- (public, as in the app); daily_push() decides what may be sent and when.
create function public.call_daily_push(p_slot text) returns void
language sql security definer set search_path = '' as $$
  select net.http_post(
    url := 'https://zvnsbuviuogrnquwkbsa.supabase.co/functions/v1/push-message',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', 'sb_publishable_3aU-A4OMVSTduMaDnEnJJA_j4PTeZOZ',
      'Authorization', 'Bearer sb_publishable_3aU-A4OMVSTduMaDnEnJJA_j4PTeZOZ'
    ),
    body := jsonb_build_object('slot', p_slot)
  );
$$;

revoke execute on function public.call_daily_push(text) from public, anon, authenticated;

select cron.schedule('push-todo', '30 2 * * *', $$select public.call_daily_push('todo')$$);
select cron.schedule('push-attendance', '0 3 * * *', $$select public.call_daily_push('attendance')$$);
select cron.schedule('push-attendance-leads', '0 5 * * *', $$select public.call_daily_push('attendance-leads')$$);
select cron.schedule('push-absent', '30 5 * * *', $$select public.call_daily_push('absent')$$);
select cron.schedule('push-fees', '30 4 * * 1', $$select public.call_daily_push('fees')$$);
select cron.schedule('push-tomorrow', '30 12 * * *', $$select public.call_daily_push('tomorrow')$$);
select cron.schedule('push-homework', '30 13 * * *', $$select public.call_daily_push('homework')$$);
