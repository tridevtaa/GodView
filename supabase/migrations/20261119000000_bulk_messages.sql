-- Bulk messages: owners and admins write once, and it lands in the chosen
-- students' conversations. message_batches keeps a record of each send.
-- bulk_push(): one notification per device, however many of a parent's
-- children it covers, once, while it is new (like message_push).

create table public.message_batches (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  body text not null,
  sent_by text not null,
  recipients int not null default 0,
  pushed_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.message_batches enable row level security;
grant select on public.message_batches to authenticated;
create policy "admins read message batches" on public.message_batches
  for select to authenticated using (public.is_school_admin(school_id));

alter table public.messages add column batch_id uuid references public.message_batches (id) on delete set null;
create index messages_batch on public.messages (batch_id) where batch_id is not null;

create function public.send_bulk_message(p_school uuid, p_students uuid[], p_body text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  who text := public.current_email();
  nm text;
  rl text;
  words text := trim(coalesce(p_body, ''));
  batch uuid;
  n int;
begin
  if not public.is_school_admin(p_school) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if length(words) not between 1 and 2000 or coalesce(cardinality(p_students), 0) not between 1 and 5000 then
    raise exception 'bad message';
  end if;
  select coalesce(nullif(trim(x.full_name), ''), split_part(x.email, '@', 1)), x.role::text into nm, rl
  from public.school_members x
  where x.school_id = p_school and x.email = who;

  insert into public.message_batches (school_id, body, sent_by) values (p_school, words, who) returning id into batch;

  -- Only this school's students. pushed_at: bulk_push tells the parents, once.
  insert into public.messages (school_id, student_id, from_parent, author, author_name, author_role, body, batch_id, pushed_at)
  select p_school, s.id, false, who, nm, rl, words, batch, now()
  from public.students s
  where s.school_id = p_school and s.id = any (p_students);
  get diagnostics n = row_count;
  if n = 0 then
    raise exception 'no students';
  end if;
  update public.message_batches set recipients = n where id = batch;

  -- The writer has read those conversations.
  insert into public.message_reads (student_id, reader, seen_at)
  select s.id, who, now()
  from public.students s
  where s.school_id = p_school and s.id = any (p_students)
  on conflict (student_id, reader) do update set seen_at = now();
  return batch;
end
$$;

create function public.bulk_push(p_batch uuid)
returns table (sub_endpoint text, sub_p256dh text, sub_auth text, title text, body text, url text)
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
  select distinct on (p.endpoint) p.endpoint, p.p256dh, p.auth, 'Your school sent a message'::text, line, '/?thread=' || m.student_id
  from public.messages m
  join public.guardian_students gs on gs.student_id = m.student_id and not gs.removed
  join public.guardians g on g.id = gs.guardian_id
  join auth.users u on u.phone_confirmed_at is not null and public.normalise_phone(u.phone) = g.phone
  join public.push_subscriptions p on p.user_id = u.id
  where m.batch_id = b.id
  order by p.endpoint, m.student_id;
end
$$;

revoke execute on function public.send_bulk_message(uuid, uuid[], text) from public, anon;
grant execute on function public.send_bulk_message(uuid, uuid[], text) to authenticated;
revoke execute on function public.bulk_push(uuid) from public, anon, authenticated;
