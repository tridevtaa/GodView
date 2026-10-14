-- Notifications for new notices: everyone at the school who turned them
-- on hears about a new notice (parents only when it is meant for them),
-- never the author. Once, while the notice is new; edits don't notify.
-- The push-message function asks notice_push() after a notice is posted.

alter table public.notices add column pushed_at timestamptz;

create function public.notice_push(p_notice uuid)
returns table (sub_endpoint text, sub_p256dh text, sub_auth text, title text, body text, url text)
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

  -- One row per device: a parent with two children here still gets one.
  return query
  select distinct on (p.endpoint) p.endpoint, p.p256dh, p.auth, head, line, '/?notice=' || n.id
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

revoke execute on function public.notice_push(uuid) from public, anon, authenticated;
grant execute on function public.notice_push(uuid) to service_role;
