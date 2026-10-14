-- Push notifications for new messages. Each phone or browser that turned
-- them on keeps one row here. After a message is sent, the push-message
-- function asks message_push() who should hear about it (the other side of
-- the conversation) and sends each of their devices a notification.

create table public.push_subscriptions (
  endpoint text primary key check (endpoint ~ '^https://' and length(endpoint) <= 1000),
  user_id uuid not null references auth.users (id) on delete cascade,
  p256dh text not null check (length(p256dh) <= 200),
  auth text not null check (length(auth) <= 100),
  created_at timestamptz not null default now()
);

create index push_subscriptions_user on public.push_subscriptions (user_id);

-- No policies: written only through the functions below.
alter table public.push_subscriptions enable row level security;

-- This device turned notifications on for the signed-in person. A device
-- that changes hands (log out, someone else signs in) moves to them.
create function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    raise exception 'not allowed';
  end if;
  insert into public.push_subscriptions (endpoint, user_id, p256dh, auth)
  values (p_endpoint, auth.uid(), p_p256dh, p_auth)
  on conflict (endpoint) do update
    set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, created_at = now();
end
$$;

-- This device turned them off, or is logging out.
create function public.drop_push_subscription(p_endpoint text) returns void
language sql security definer set search_path = '' as $$
  delete from public.push_subscriptions where endpoint = p_endpoint and user_id = auth.uid()
$$;

-- Each message is announced once, and only while it is new.
alter table public.messages add column pushed_at timestamptz;

-- Who hears about a message, one row per device, with what to show.
-- A parent wrote: the child's class teachers and the principal (the owner
-- and admins when no teacher has the class). The school wrote: the child's
-- parents. Never the writer. For the push-message function only.
create function public.message_push(p_message uuid)
returns table (sub_endpoint text, sub_p256dh text, sub_auth text, title text, body text, url text)
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
    select p.endpoint, p.p256dh, p.auth, head, left(m.body, 180), '/?thread=' || m.student_id
    from public.push_subscriptions p
    join auth.users u on u.id = p.user_id
    where u.email_confirmed_at is not null
      and lower(u.email) in (select st.email from staff st where st.email <> m.author);
  else
    return query
    select p.endpoint, p.p256dh, p.auth, head, left(m.body, 180), '/?thread=' || m.student_id
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

-- The push service says this device is gone (app removed, permission
-- taken back): stop sending to it. For the push-message function only.
create function public.forget_push_subscription(p_endpoint text) returns void
language sql security definer set search_path = '' as $$
  delete from public.push_subscriptions where endpoint = p_endpoint
$$;

revoke execute on function public.save_push_subscription(text, text, text) from public, anon;
revoke execute on function public.drop_push_subscription(text) from public, anon;
revoke execute on function public.message_push(uuid) from public, anon, authenticated;
revoke execute on function public.forget_push_subscription(text) from public, anon, authenticated;
grant execute on function public.save_push_subscription(text, text, text) to authenticated;
grant execute on function public.drop_push_subscription(text) to authenticated;
grant execute on function public.message_push(uuid) to service_role;
grant execute on function public.forget_push_subscription(text) to service_role;
