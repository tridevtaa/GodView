-- Notification titles that read with the line iPhones put under them
-- ("from Godview", or the school's name), and the details below:
--   Attendance Reminder      Mark attendance for Class 5 A
--   Absence Alert            Aarav was marked absent today
--   Your To-Do for Today     3 unread messages · 1 request to answer
--   Tomorrow's Events        Sports Day · Parent-Teacher Meeting
--   Homework Reminder        Due tomorrow for Aarav: Maths, English
--   Fee Reminder             Aarav fees: ₹5,000 due tomorrow
--   New Notice               Karate Inter-School Competition: All students…
--   Priya sent a message     Aarav · Please send the form tomorrow
-- Only the titles (and the notice and message lines) change.

-- The name to greet someone by: the first word, or the first two after a
-- title ("Mrs Sharma"). Null when there's no name.
create or replace function public.first_name(full_name text) returns text
language sql immutable set search_path = '' as $$
  select case
    when nullif(trim(full_name), '') is null then null
    when lower(regexp_replace(split_part(trim(full_name), ' ', 1), '\.$', '')) in ('mr', 'mrs', 'ms', 'miss', 'dr', 'sir', 'smt', 'shri')
      and split_part(regexp_replace(trim(full_name), '\s+', ' ', 'g'), ' ', 2) <> ''
      then split_part(regexp_replace(trim(full_name), '\s+', ' ', 'g'), ' ', 1) || ' ' || split_part(regexp_replace(trim(full_name), '\s+', ' ', 'g'), ' ', 2)
    else split_part(trim(full_name), ' ', 1)
  end
$$;

create or replace function public.message_push(p_message uuid)
returns table (sub_endpoint text, sub_p256dh text, sub_auth text, title text, body text, url text)
language plpgsql security definer set search_path = '' as $$
declare
  m public.messages;
  child text;
  who text;
  head text;
  line text;
begin
  update public.messages x set pushed_at = now()
  where x.id = p_message and x.pushed_at is null and x.created_at > now() - interval '10 minutes'
  returning * into m;
  if m.id is null then
    return;
  end if;

  select split_part(trim(s.name), ' ', 1) into child from public.students s where s.id = m.student_id;
  who := public.first_name(m.author_name);
  head := coalesce(who, case when m.from_parent then 'A parent' else 'Your school' end) || ' sent a message';
  -- Which child it's about, ahead of the words.
  line := left(coalesce(child || ' · ', '') || regexp_replace(trim(m.body), '\s+', ' ', 'g'), 180);

  if m.from_parent then
    return query
    with teachers as (
      select t.email
      from public.student_enrolments e
      join public.teacher_classes t
        on t.school_id = e.school_id
       and t.session_id = e.session_id
       and t.class = e.class
       and (t.section is null or t.section = e.section)
      join public.school_members sm on sm.school_id = t.school_id and sm.email = t.email
      where e.student_id = m.student_id
    ),
    staff as (
      select tt.email from teachers tt
      union
      select sm.email from public.school_members sm
      where sm.school_id = m.school_id
        and (sm.role::text = 'principal' or (sm.role::text in ('owner', 'admin') and not exists (select 1 from teachers)))
    )
    select p.endpoint, p.p256dh, p.auth, head, line, '/?thread=' || m.student_id
    from public.push_subscriptions p
    join auth.users u on u.id = p.user_id
    where u.email_confirmed_at is not null
      and lower(u.email) in (select st.email from staff st where st.email <> m.author);
  else
    return query
    select p.endpoint, p.p256dh, p.auth, head, line, '/?thread=' || m.student_id
    from public.push_subscriptions p
    join auth.users u on u.id = p.user_id
    where u.phone_confirmed_at is not null
      and public.normalise_phone(u.phone) in (
        select g.phone
        from public.guardian_students gs
        join public.guardians g on g.id = gs.guardian_id
        where gs.student_id = m.student_id and not gs.removed
      );
  end if;
end
$$;

create or replace function public.notice_push(p_notice uuid)
returns table (sub_endpoint text, sub_p256dh text, sub_auth text, title text, body text, url text)
language plpgsql security definer set search_path = '' as $$
declare
  n public.notices;
  line text;
begin
  update public.notices x set pushed_at = now()
  where x.id = p_notice and x.pushed_at is null and x.created_at > now() - interval '10 minutes'
  returning * into n;
  if n.id is null then
    return;
  end if;

  -- The notice's title, then the start of its text.
  line := left(trim(n.title) || coalesce(': ' || nullif(regexp_replace(trim(n.body), '\s+', ' ', 'g'), ''), ''), 180);

  -- One row per device: a parent with two children here still gets one.
  return query
  select distinct on (p.endpoint) p.endpoint, p.p256dh, p.auth, 'New Notice'::text, line, '/?notice=' || n.id
  from public.push_subscriptions p
  join auth.users u on u.id = p.user_id
  where (
      u.email_confirmed_at is not null
      and lower(u.email) <> n.created_by
      and lower(u.email) in (select sm.email from public.school_members sm where sm.school_id = n.school_id)
    ) or (
      n.for_parents
      and u.phone_confirmed_at is not null
      and public.normalise_phone(u.phone) in (
        select g.phone
        from public.guardians g
        join public.guardian_students gs on gs.guardian_id = g.id and not gs.removed
        where gs.school_id = n.school_id
      )
    );
end
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
    select s.endpoint, s.p256dh, s.auth, 'Attendance Reminder'::text,
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
    select s.endpoint, s.p256dh, s.auth, 'Attendance Reminder'::text,
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
    select s.endpoint, s.p256dh, s.auth, 'Your To-Do for Today'::text,
      concat_ws(' · ',
        case when c.unread > 0 then c.unread || ' unread ' || case when c.unread = 1 then 'message' else 'messages' end end,
        case when c.requests > 0 then c.requests || case when c.requests = 1 then ' request' else ' requests' end || ' to answer' end,
        case when c.access > 0 then c.access || ' waiting for app access' end),
      case when c.unread + c.requests > 0 then '/?go=requests' else '/?go=access' end
    from counts c join public.staff_devices() s on s.email = c.email
    where c.unread + c.requests + c.access > 0;

  elsif p_slot = 'absent' then
    return query
    select p.endpoint, p.p256dh, p.auth, 'Absence Alert'::text,
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
    select p.endpoint, p.p256dh, p.auth, 'Homework Reminder'::text,
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
    select s.endpoint, s.p256dh, s.auth, 'Tomorrow''s Events'::text, left(x.list, 180), '/?go=calendar'
    from for_staff x
    join public.school_members m on m.school_id = x.school_id
    join public.staff_devices() s on s.email = m.email
    union all
    select s.endpoint, s.p256dh, s.auth, 'Tomorrow''s Events'::text, left(x.list, 180), '/?go=calendar'
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
    select p.endpoint, p.p256dh, p.auth, 'Fee Reminder'::text,
      split_part(trim(st.name), ' ', 1) || ' fees: ' || l.text,
      '/?go=fees&child=' || l.student_id
    from lines l
    join public.students st on st.id = l.student_id
    cross join lateral public.student_parent_devices(l.student_id) p;
  end if;
end
$$;
