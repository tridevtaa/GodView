-- Fee reminders for parents, every day at 10:00 IST (Sundays and holidays
-- too), instead of Mondays for fees 15+ days overdue. For each child, one
-- push naming what applies today:
--   a week before a fee is due   "Aarav fees: ₹5,000 due on 27 Oct"
--   the day before               "… ₹5,000 due tomorrow"
--   the day it's due             "… ₹5,000 due today"
--   every day it's overdue       "… ₹5,000 overdue"
-- Still only for students active in their school's current session, and
-- only fees with a due date and something left to pay.

-- "₹1,25,000"
create function public.rupees(amount numeric) returns text
language sql immutable set search_path = '' as $$
  select '₹' || to_char(round(amount), 'FM99,99,99,999')
$$;

create or replace function public.daily_push(p_slot text)
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
    or (p_slot = 'fees' and t between '09:55' and '12:00')
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
    -- One push per child, naming each stage that applies today.
    return query
    with owed as (
      select b.student_id,
        sum(b.balance) filter (where b.due_date < d) as overdue,
        sum(b.balance) filter (where b.due_date = d) as today,
        sum(b.balance) filter (where b.due_date = d + 1) as tomorrow,
        sum(b.balance) filter (where b.due_date = d + 7) as week
      from public.fee_invoice_balances b
      -- Only students attending now: active in their school's current session.
      join public.student_enrolments e
        on e.student_id = b.student_id and e.session_id = public.current_session(e.school_id) and e.status = 'active'
      where b.balance > 0.009 and b.due_date is not null and b.due_date <= d + 7
      group by b.student_id
    ),
    lines as (
      select o.student_id,
        concat_ws(' · ',
          case when o.overdue > 0 then public.rupees(o.overdue) || ' overdue' end,
          case when o.today > 0 then public.rupees(o.today) || ' due today' end,
          case when o.tomorrow > 0 then public.rupees(o.tomorrow) || ' due tomorrow' end,
          case when o.week > 0 then public.rupees(o.week) || ' due on ' || to_char(d + 7, 'FMDD Mon') end
        ) as text
      from owed o
      where coalesce(o.overdue, 0) + coalesce(o.today, 0) + coalesce(o.tomorrow, 0) + coalesce(o.week, 0) > 0
    )
    select p.endpoint, p.p256dh, p.auth, 'Fees'::text,
      split_part(trim(st.name), ' ', 1) || ' fees: ' || l.text,
      '/?go=fees&child=' || l.student_id
    from lines l
    join public.students st on st.id = l.student_id
    cross join lateral public.student_parent_devices(l.student_id) p;
  end if;
end
$$;

-- Was Mondays only.
select cron.schedule('push-fees', '30 4 * * *', $$select public.call_daily_push('fees')$$);
