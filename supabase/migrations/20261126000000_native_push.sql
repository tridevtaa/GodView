-- Native push (the Android/iOS app, via Firebase Cloud Messaging) alongside
-- the existing Web Push subscriptions. A native device's FCM token is kept
-- in the same push_subscriptions table as a device with no p256dh/auth —
-- every function below already selects whichever devices match a person by
-- email/phone, so none of that matching logic needs to change. Only the
-- new "platform" column is threaded through so push-message knows whether
-- to send a row with Web Push or FCM.

alter table public.push_subscriptions
  alter column p256dh drop not null,
  alter column auth drop not null,
  add column platform text not null default 'web' check (platform in ('web', 'android', 'ios'));

alter table public.push_subscriptions drop constraint push_subscriptions_endpoint_check;
alter table public.push_subscriptions add constraint push_subscriptions_endpoint_check check (
  (platform = 'web' and endpoint ~ '^https://' and length(endpoint) <= 1000)
  or (platform <> 'web' and length(endpoint) <= 500)
);

-- An FCM registration token for this device (the "endpoint" column doubles
-- as the token: it is already a unique opaque string with nothing else
-- keyed off its shape). Re-registering the same token just refreshes it;
-- a device that changes hands moves to whoever is now signed in, same as
-- save_push_subscription.
create function public.save_native_push_token(p_token text, p_platform text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    raise exception 'not allowed';
  end if;
  if p_platform not in ('android', 'ios') then
    raise exception 'bad platform';
  end if;
  insert into public.push_subscriptions (endpoint, user_id, p256dh, auth, platform)
  values (p_token, auth.uid(), null, null, p_platform)
  on conflict (endpoint) do update
    set user_id = excluded.user_id, platform = excluded.platform, created_at = now();
end
$$;

revoke execute on function public.save_native_push_token(text, text) from public, anon;
grant execute on function public.save_native_push_token(text, text) to authenticated;

-- ----------------------------------------------- thread "platform" through

-- Postgres won't let CREATE OR REPLACE change a function's return columns,
-- even just appending one — these all need a real drop first. Dropped in
-- dependency order (student_parent_devices calls parent_devices as a SQL
-- function, which Postgres tracks as a hard dependency; the others are
-- plpgsql, which don't get tracked that way).
drop function public.message_push(uuid);
drop function public.notice_push(uuid);
drop function public.bulk_push(uuid);
drop function public.daily_push(text);
drop function public.student_parent_devices(uuid);
drop function public.parent_devices();
drop function public.staff_devices();

create function public.staff_devices() returns table (email text, endpoint text, p256dh text, auth text, platform text)
language sql stable security definer set search_path = '' as $$
  select lower(u.email), p.endpoint, p.p256dh, p.auth, p.platform
  from public.push_subscriptions p join auth.users u on u.id = p.user_id
  where u.email_confirmed_at is not null
$$;

create function public.parent_devices() returns table (phone text, endpoint text, p256dh text, auth text, platform text)
language sql stable security definer set search_path = '' as $$
  select public.normalise_phone(u.phone), p.endpoint, p.p256dh, p.auth, p.platform
  from public.push_subscriptions p join auth.users u on u.id = p.user_id
  where u.phone_confirmed_at is not null
$$;

create function public.student_parent_devices(student uuid) returns table (endpoint text, p256dh text, auth text, platform text)
language sql stable security definer set search_path = '' as $$
  select distinct s.endpoint, s.p256dh, s.auth, s.platform
  from public.guardian_students gs
  join public.guardians g on g.id = gs.guardian_id
  join public.parent_devices() s on s.phone = g.phone
  where gs.student_id = student and not gs.removed
$$;

create function public.message_push(p_message uuid)
returns table (sub_endpoint text, sub_p256dh text, sub_auth text, title text, body text, url text, platform text)
language plpgsql security definer set search_path = '' as $$
declare
  m public.messages;
  child text;
  head text;
begin
  update public.messages x set pushed_at = now()
  where x.id = p_message and x.pushed_at is null and x.created_at > now() - interval '10 minutes'
  returning * into m;
  if m.id is null then
    return;
  end if;

  select split_part(trim(s.name), ' ', 1) into child from public.students s where s.id = m.student_id;
  head := coalesce(nullif(trim(m.author_name), ''), case when m.from_parent then 'Parent' else 'School' end)
    || coalesce(' · ' || child, '');

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
    select p.endpoint, p.p256dh, p.auth, head, left(m.body, 180), '/?thread=' || m.student_id, p.platform
    from public.push_subscriptions p
    join auth.users u on u.id = p.user_id
    where u.email_confirmed_at is not null
      and lower(u.email) in (select st.email from staff st where st.email <> m.author);
  else
    return query
    select p.endpoint, p.p256dh, p.auth, head, left(m.body, 180), '/?thread=' || m.student_id, p.platform
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

create function public.notice_push(p_notice uuid)
returns table (sub_endpoint text, sub_p256dh text, sub_auth text, title text, body text, url text, platform text)
language plpgsql security definer set search_path = '' as $$
declare
  n public.notices;
  head text;
  line text;
begin
  update public.notices x set pushed_at = now()
  where x.id = p_notice and x.pushed_at is null and x.created_at > now() - interval '10 minutes'
  returning * into n;
  if n.id is null then
    return;
  end if;

  head := 'Notice: ' || n.title;
  line := coalesce(
    nullif(left(regexp_replace(trim(n.body), '\s+', ' ', 'g'), 180), ''),
    'From ' || coalesce(nullif(trim(n.author_name), ''), 'the school')
  );

  return query
  select distinct on (p.endpoint) p.endpoint, p.p256dh, p.auth, head, line, '/?notice=' || n.id, p.platform
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

create function public.bulk_push(p_batch uuid)
returns table (sub_endpoint text, sub_p256dh text, sub_auth text, title text, body text, url text, platform text)
language plpgsql security definer set search_path = '' as $$
declare
  b public.message_batches;
  line text;
begin
  update public.message_batches x set pushed_at = now()
  where x.id = p_batch and x.pushed_at is null and x.created_at > now() - interval '10 minutes'
  returning * into b;
  if b.id is null then
    return;
  end if;
  line := left(regexp_replace(trim(b.body), '\s+', ' ', 'g'), 180);

  return query
  select distinct on (p.endpoint) p.endpoint, p.p256dh, p.auth, 'Your school sent a message'::text, line, '/?thread=' || m.student_id, p.platform
  from public.messages m
  join public.guardian_students gs on gs.student_id = m.student_id and not gs.removed
  join public.guardians g on g.id = gs.guardian_id
  join auth.users u on u.phone_confirmed_at is not null and public.normalise_phone(u.phone) = g.phone
  join public.push_subscriptions p on p.user_id = u.id
  where m.batch_id = b.id
  order by p.endpoint, m.student_id;
end
$$;

create function public.daily_push(p_slot text)
returns table (sub_endpoint text, sub_p256dh text, sub_auth text, title text, body text, url text, platform text)
language plpgsql security definer set search_path = '' as $$
declare
  d date := public.ist_today();
  t time := (now() at time zone 'Asia/Kolkata')::time;
begin
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
    select s.endpoint, s.p256dh, s.auth, 'Attendance'::text,
      'Mark attendance for ' || case when x.n <= 3 then x.list else x.n || ' classes' end,
      '/?go=attendance', s.platform
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
      '/?go=attendance', s.platform
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
      case when c.unread + c.requests > 0 then '/?go=requests' else '/?go=access' end,
      s.platform
    from counts c join public.staff_devices() s on s.email = c.email
    where c.unread + c.requests + c.access > 0;

  elsif p_slot = 'absent' then
    return query
    select p.endpoint, p.p256dh, p.auth, 'Attendance'::text,
      split_part(trim(st.name), ' ', 1) || ' was marked absent today', '/?thread=' || a.student_id, p.platform
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
      '/?go=homework&child=' || u.student_id, p.platform
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
    select s.endpoint, s.p256dh, s.auth, 'Tomorrow'::text, left(x.list, 180), '/?go=calendar', s.platform
    from for_staff x
    join public.school_members m on m.school_id = x.school_id
    join public.staff_devices() s on s.email = m.email
    union all
    select s.endpoint, s.p256dh, s.auth, 'Tomorrow'::text, left(x.list, 180), '/?go=calendar', s.platform
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
      '/?go=fees&child=' || o.student_id, p.platform
    from owed o
    join public.students st on st.id = o.student_id
    cross join lateral public.student_parent_devices(o.student_id) p;
  end if;
end
$$;

-- The drop above also dropped these grants (a freshly created function
-- defaults to EXECUTE for PUBLIC) — restoring exactly what each had before.
revoke execute on function public.staff_devices() from public, anon, authenticated;
revoke execute on function public.parent_devices() from public, anon, authenticated;
revoke execute on function public.student_parent_devices(uuid) from public, anon, authenticated;
revoke execute on function public.message_push(uuid) from public, anon, authenticated;
grant execute on function public.message_push(uuid) to service_role;
revoke execute on function public.notice_push(uuid) from public, anon, authenticated;
grant execute on function public.notice_push(uuid) to service_role;
revoke execute on function public.bulk_push(uuid) from public, anon, authenticated;
revoke execute on function public.daily_push(text) from public, anon, authenticated;
grant execute on function public.daily_push(text) to service_role;
