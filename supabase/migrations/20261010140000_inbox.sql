-- Inbox: one conversation per child, like a messaging app. Parents, the
-- child's teachers and the office all write in it. Leave and certificate
-- requests stay in parent_requests and show inside the conversation as
-- cards staff approve or decline. The diary (student_notes, signatures and
-- staff-only notes) is removed, as the school decided.

-- ---------------------------------------------------------------- diary ---

drop function public.sign_diary(uuid, text);
drop table public.diary_signatures;
drop table public.student_notes;
drop function public.note_author();

-- ------------------------------------------------------------- messages ---

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  student_id uuid not null,
  from_parent boolean not null,
  author text not null, -- staff email or parent phone
  author_name text check (length(author_name) <= 120),
  author_role text check (length(author_role) <= 40),
  body text not null check (length(trim(body)) between 1 and 2000),
  created_at timestamptz not null default now(),
  foreign key (student_id, school_id) references public.students (id, school_id) on delete cascade
);

create index messages_student on public.messages (student_id, created_at desc);
create index messages_school on public.messages (school_id, created_at desc);

alter table public.messages enable row level security;
grant select on public.messages to authenticated;

-- Everyone in the conversation reads it: the child's parents, staff who see
-- the child, and the principal. Writing only through send_message().
create policy "parents read their children's messages" on public.messages
  for select to authenticated using (public.is_parent_of(student_id));
create policy "staff read messages of their students" on public.messages
  for select to authenticated using (public.can_see_student(student_id));
create policy "principal reads messages" on public.messages
  for select to authenticated using (public.is_principal(school_id));

-- When each staff member last read each conversation (parents use
-- parent_seen, section 'inbox').
create table public.message_reads (
  student_id uuid not null references public.students (id) on delete cascade,
  reader text not null,
  seen_at timestamptz not null default now(),
  primary key (student_id, reader)
);

alter table public.message_reads enable row level security;

-- Staff who see the child, or the child's parent, write a message. Signed
-- with their name and role (teacher, admin…; father, mother…).
create function public.send_message(student uuid, p_body text) returns public.messages
language plpgsql security definer set search_path = '' as $$
declare
  s public.students;
  m public.messages;
  who text;
  nm text;
  rl text;
  parent boolean := false;
begin
  select * into s from public.students where id = student;
  if s.id is null then
    raise exception 'not allowed';
  end if;
  if public.can_see_student(student) then
    who := public.current_email();
    select coalesce(nullif(trim(x.full_name), ''), split_part(x.email, '@', 1)), x.role::text
      into nm, rl
    from public.school_members x
    where x.school_id = s.school_id and x.email = who;
  elsif public.is_parent_of(student) then
    parent := true;
    who := public.current_phone();
    select g.name, gs.relation into nm, rl
    from public.guardians g
    left join public.guardian_students gs on gs.guardian_id = g.id and gs.student_id = student
    where g.school_id = s.school_id and g.phone = who
    limit 1;
  else
    raise exception 'not allowed';
  end if;

  insert into public.messages (school_id, student_id, from_parent, author, author_name, author_role, body)
  values (s.school_id, student, parent, who, nm, rl, trim(p_body))
  returning * into m;

  -- The writer has read the conversation.
  if parent then
    insert into public.parent_seen (phone, student_id, section, seen_at)
    values (who, student, 'inbox', now())
    on conflict (phone, student_id, section) do update set seen_at = now();
  else
    insert into public.message_reads (student_id, reader, seen_at)
    values (student, who, now())
    on conflict (student_id, reader) do update set seen_at = now();
  end if;
  return m;
end
$$;

-- Staff mark a conversation read.
create function public.mark_thread_read(student uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not (public.can_see_student(student) or exists (
    select 1 from public.students s where s.id = student and public.is_principal(s.school_id)
  )) then
    raise exception 'not allowed';
  end if;
  insert into public.message_reads (student_id, reader, seen_at)
  values (student, public.current_email(), now())
  on conflict (student_id, reader) do update set seen_at = now();
end
$$;

-- The staff inbox: one row per conversation the caller can see, with the
-- latest message or request, how many parent messages are unread, and how
-- many requests are still open.
create function public.staff_inbox(school uuid)
returns table (student_id uuid, last_at timestamptz, last_body text, last_from_parent boolean, last_author text, unread bigint, open_requests bigint)
language sql stable security definer set search_path = '' as $$
  with items as (
    select m.student_id, m.created_at as at, m.body, m.from_parent, m.author_name as who
    from public.messages m
    where m.school_id = school
    union all
    select r.student_id, r.created_at,
      case r.kind when 'leave' then 'Leave request' when 'certificate' then 'Certificate request' else r.subject end,
      true, null
    from public.parent_requests r
    where r.school_id = school and r.status <> 'cancelled'
  ),
  visible as (
    select v.student_id
    from (select distinct i.student_id from items i) v
    where public.is_principal(school) or public.can_see_student(v.student_id)
  ),
  latest as (
    select distinct on (i.student_id) i.*
    from items i
    join visible v on v.student_id = i.student_id
    order by i.student_id, i.at desc
  )
  select l.student_id, l.at, l.body, l.from_parent, l.who,
    (
      select count(*) from items i
      where i.student_id = l.student_id and i.from_parent
        and i.at > coalesce((
          select mr.seen_at from public.message_reads mr
          where mr.student_id = l.student_id and mr.reader = public.current_email()
        ), '-infinity')
    ),
    (
      select count(*) from public.parent_requests r
      where r.student_id = l.student_id and r.status = 'open'
    )
  from latest l
  order by l.at desc
$$;

revoke execute on function public.send_message(uuid, text) from public, anon;
revoke execute on function public.mark_thread_read(uuid) from public, anon;
revoke execute on function public.staff_inbox(uuid) from public, anon;
grant execute on function public.send_message(uuid, text) to authenticated;
grant execute on function public.mark_thread_read(uuid) to authenticated;
grant execute on function public.staff_inbox(uuid) to authenticated;

-- ------------------------------------------- old "message" requests ---

-- Earlier parent messages (and staff replies) move into the conversation.
insert into public.messages (school_id, student_id, from_parent, author, author_name, author_role, body, created_at)
select r.school_id, r.student_id, true, coalesce(r.created_by, ''), g.name, gs.relation,
  left(trim(r.subject || case when coalesce(trim(r.body), '') <> '' then E'\n' || trim(r.body) else '' end), 2000),
  r.created_at
from public.parent_requests r
left join public.guardians g on g.id = r.guardian_id
left join public.guardian_students gs on gs.guardian_id = r.guardian_id and gs.student_id = r.student_id
where r.kind = 'message';

insert into public.messages (school_id, student_id, from_parent, author, author_name, author_role, body, created_at)
select r.school_id, r.student_id, false, coalesce(r.handled_by, ''),
  coalesce(nullif(trim(m.full_name), ''), split_part(r.handled_by, '@', 1)), m.role::text,
  left(trim(r.response), 2000), coalesce(r.handled_at, r.updated_at)
from public.parent_requests r
left join public.school_members m on m.school_id = r.school_id and m.email = r.handled_by
where r.kind = 'message' and coalesce(trim(r.response), '') <> '';

delete from public.parent_requests where kind = 'message';

-- An app that still sends a "message" request (an old copy on a phone)
-- writes into the conversation instead.
create or replace function public.create_request(
  p_student uuid,
  p_kind text,
  p_subject text,
  p_body text,
  p_leave_from date,
  p_leave_to date,
  p_certificate_type text
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  s public.students;
  gid uuid;
  rid uuid;
begin
  select * into s from public.students where id = p_student;
  if s.id is null or not public.is_parent_of(p_student) then
    raise exception 'not allowed';
  end if;
  if p_kind = 'message' then
    return (public.send_message(
      p_student,
      trim(p_subject || case when coalesce(trim(p_body), '') <> '' then E'\n' || trim(p_body) else '' end)
    )).id;
  end if;
  select g.id into gid from public.guardians g
  where g.school_id = s.school_id and g.phone = public.current_phone();
  insert into public.parent_requests
    (school_id, student_id, guardian_id, kind, subject, body, leave_from, leave_to, certificate_type, created_by)
  values
    (s.school_id, p_student, gid, p_kind, trim(p_subject), p_body, p_leave_from, p_leave_to, p_certificate_type, public.current_phone())
  returning id into rid;
  return rid;
end
$$;

-- ------------------------------------------------------ parents' counts ---

alter table public.parent_seen drop constraint parent_seen_section_check;
alter table public.parent_seen add constraint parent_seen_section_check
  check (section in ('fees', 'results', 'notes', 'homework', 'requests', 'inbox'));

-- Sections are now fees, results, homework and inbox (new staff messages
-- and answered requests).
create or replace function public.parent_unread()
returns table (student_id uuid, section text, unread bigint, seen_at timestamptz)
language sql stable security invoker set search_path = '' as $$
  with kids as (
    select s.id from public.students s where public.is_parent_of(s.id)
  ),
  sections as (
    select k.id as student_id, x.section, ps.seen_at
    from kids k
    cross join (values ('fees'), ('results'), ('homework'), ('inbox')) as x (section)
    left join public.parent_seen ps
      on ps.student_id = k.id and ps.section = x.section and ps.phone = public.current_phone()
  )
  select
    s.student_id,
    s.section,
    case s.section
      when 'results' then (
        select count(*) from public.exam_results r
        where r.student_id = s.student_id and r.updated_at > coalesce(s.seen_at, '-infinity'))
      when 'fees' then (
        select count(*) from public.fee_invoices i
        where i.student_id = s.student_id and i.created_at > coalesce(s.seen_at, '-infinity'))
        + (
        select count(*) from public.fee_payments p
        where p.student_id = s.student_id and p.created_at > coalesce(s.seen_at, '-infinity'))
      when 'homework' then (
        select count(*) from public.child_homework(s.student_id) h
        where h.created_at > coalesce(s.seen_at, '-infinity'))
      else (
        select count(*) from public.messages m
        where m.student_id = s.student_id and not m.from_parent
          and m.created_at > coalesce(s.seen_at, '-infinity'))
        + (
        select count(*) from public.parent_requests q
        where q.student_id = s.student_id and q.handled_at is not null
          and q.handled_at > coalesce(s.seen_at, '-infinity'))
    end,
    s.seen_at
  from sections s
$$;
