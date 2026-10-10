-- The student diary and homework.
--
-- Diary: notes become dated diary pages written to parents, signed with the
-- teacher's name, with an optional stamp (remark, appreciation, concern,
-- reminder). Parents sign each page in their app, optionally with a short
-- reply, like signing a school diary. "Staff only" pages stay private.
--
-- Homework: a teacher (or admin) sets work for a class, a section, or only
-- some students in it. Parents see their child's homework.

-- ---------------------------------------------------------------- diary ---

alter table public.student_notes
  add column kind text not null default 'remark'
    check (kind in ('remark', 'appreciation', 'concern', 'reminder')),
  add column author_name text check (length(author_name) <= 120),
  add column author_role text check (length(author_role) <= 80);

-- The page is signed with the writer's name and role from the team list.
create function public.note_author() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  select coalesce(nullif(trim(m.full_name), ''), split_part(m.email, '@', 1)),
         coalesce(nullif(trim(m.designation), ''), initcap(m.role::text))
    into new.author_name, new.author_role
  from public.school_members m
  where m.school_id = new.school_id and m.email = new.author_email;
  return new;
end
$$;

revoke execute on function public.note_author() from public, anon, authenticated;

create trigger student_notes_author before insert on public.student_notes
  for each row execute function public.note_author();

-- Fill in names for pages written before this.
update public.student_notes n set author_name = coalesce(nullif(trim(m.full_name), ''), split_part(m.email, '@', 1)),
  author_role = coalesce(nullif(trim(m.designation), ''), initcap(m.role::text))
from public.school_members m
where m.school_id = n.school_id and m.email = n.author_email and n.author_name is null;

-- A parent's signature on a diary page (one per page; the latest wins).
create table public.diary_signatures (
  note_id uuid primary key references public.student_notes (id) on delete cascade,
  school_id uuid not null references public.schools (id) on delete cascade,
  signed_by text not null, -- the parent's mobile
  signed_at timestamptz not null default now(),
  reply text check (length(reply) <= 1000)
);

alter table public.diary_signatures enable row level security;
grant select on public.diary_signatures to authenticated;

create policy "staff who see the student see signatures" on public.diary_signatures
  for select to authenticated using (
    exists (select 1 from public.student_notes n where n.id = note_id and public.can_see_student(n.student_id))
  );
create policy "parents see signatures on their children's pages" on public.diary_signatures
  for select to authenticated using (
    exists (select 1 from public.student_notes n where n.id = note_id and n.shared_with_parents and public.is_parent_of(n.student_id))
  );

create function public.sign_diary(note uuid, p_reply text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  n public.student_notes;
begin
  select * into n from public.student_notes where id = note;
  if n.id is null or not n.shared_with_parents or not public.is_parent_of(n.student_id) then
    raise exception 'not allowed';
  end if;
  insert into public.diary_signatures (note_id, school_id, signed_by, reply)
  values (n.id, n.school_id, public.current_phone(), nullif(left(trim(p_reply), 1000), ''))
  on conflict (note_id) do update set
    signed_by = excluded.signed_by, signed_at = now(), reply = excluded.reply;
end
$$;

revoke execute on function public.sign_diary(uuid, text) from public, anon;
grant execute on function public.sign_diary(uuid, text) to authenticated;

-- ------------------------------------------------------------- homework ---

create table public.homework (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  session_id uuid not null,
  class text not null,
  section text, -- null = every section of the class
  subject text check (length(subject) <= 80),
  body text not null check (length(trim(body)) between 1 and 4000),
  due_date date,
  created_by text not null default public.current_email(),
  author_name text check (length(author_name) <= 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (session_id, school_id) references public.academic_sessions (id, school_id) on delete cascade
);

create index homework_class on public.homework (school_id, session_id, class, created_at desc);

-- Only some students (no rows = the whole class or section).
create table public.homework_students (
  homework_id uuid not null references public.homework (id) on delete cascade,
  student_id uuid not null,
  school_id uuid not null,
  primary key (homework_id, student_id),
  foreign key (student_id, school_id) references public.students (id, school_id) on delete cascade
);

-- Owner/admin, or a teacher assigned to that class (and section; a teacher
-- of every section can set work for the whole class).
create function public.can_teach(school uuid, session uuid, klass text, sec text) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_school_admin(school) or exists (
    select 1 from public.teacher_classes t
    where t.school_id = school and t.session_id = session and t.email = public.current_email()
      and t.class = klass and (t.section is null or (sec is not null and t.section = sec))
  )
$$;

-- Staff who teach any part of the class can read its homework.
create function public.teaches_class(school uuid, session uuid, klass text, sec text) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_school_admin(school) or exists (
    select 1 from public.teacher_classes t
    where t.school_id = school and t.session_id = session and t.email = public.current_email()
      and t.class = klass and (sec is null or t.section is null or t.section = sec)
  )
$$;

create function public.homework_author() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  select coalesce(nullif(trim(m.full_name), ''), split_part(m.email, '@', 1)) into new.author_name
  from public.school_members m
  where m.school_id = new.school_id and m.email = new.created_by;
  new.section := nullif(trim(new.section), '');
  return new;
end
$$;

revoke execute on function public.homework_author() from public, anon, authenticated;

create trigger homework_author before insert on public.homework
  for each row execute function public.homework_author();
create trigger homework_touch before update on public.homework
  for each row execute function public.touch();

alter table public.homework enable row level security;
alter table public.homework_students enable row level security;
grant select, insert, update, delete on public.homework to authenticated;
grant select, insert, delete on public.homework_students to authenticated;

create policy "staff of the class read homework" on public.homework
  for select to authenticated using (public.teaches_class(school_id, session_id, class, section));
create policy "teachers of the class set homework" on public.homework
  for insert to authenticated with check (
    public.can_teach(school_id, session_id, class, section) and created_by = public.current_email()
  );
create policy "writers or admins change homework" on public.homework
  for update to authenticated
  using (created_by = public.current_email() or public.is_school_admin(school_id))
  with check (public.can_teach(school_id, session_id, class, section));
create policy "writers or admins remove homework" on public.homework
  for delete to authenticated using (created_by = public.current_email() or public.is_school_admin(school_id));

create policy "staff of the class read homework students" on public.homework_students
  for select to authenticated using (
    exists (select 1 from public.homework h where h.id = homework_id and public.teaches_class(h.school_id, h.session_id, h.class, h.section))
  );
create policy "writers pick homework students" on public.homework_students
  for insert to authenticated with check (
    exists (select 1 from public.homework h where h.id = homework_id
      and (h.created_by = public.current_email() or public.is_school_admin(h.school_id)))
    and exists (
      select 1 from public.homework h
      join public.student_enrolments e on e.session_id = h.session_id and e.student_id = homework_students.student_id
      where h.id = homework_id and e.class = h.class and (h.section is null or e.section = h.section)
    )
  );
create policy "writers remove homework students" on public.homework_students
  for delete to authenticated using (
    exists (select 1 from public.homework h where h.id = homework_id
      and (h.created_by = public.current_email() or public.is_school_admin(h.school_id)))
  );

-- One child's homework (their class and section this session, minus work
-- set only for other students). For their parents and for staff who can
-- see the child.
create function public.child_homework(student uuid)
returns table (id uuid, subject text, body text, due_date date, author_name text, created_at timestamptz, class text, section text, just_some boolean)
language sql stable security definer set search_path = '' as $$
  select h.id, h.subject, h.body, h.due_date, h.author_name, h.created_at, h.class, h.section,
         exists (select 1 from public.homework_students x where x.homework_id = h.id)
  from public.student_enrolments e
  join public.academic_sessions a on a.id = e.session_id
  join public.homework h on h.session_id = e.session_id and h.class = e.class and (h.section is null or h.section = e.section)
  where e.student_id = student
    and (public.is_parent_of(student) or public.can_see_student(student))
    and e.session_id = (
      select e2.session_id from public.student_enrolments e2
      join public.academic_sessions a2 on a2.id = e2.session_id
      where e2.student_id = student order by a2.name desc limit 1
    )
    and (
      not exists (select 1 from public.homework_students x where x.homework_id = h.id)
      or exists (select 1 from public.homework_students x where x.homework_id = h.id and x.student_id = student)
    )
  order by h.created_at desc
$$;

revoke execute on function public.can_teach(uuid, uuid, text, text) from public, anon;
revoke execute on function public.teaches_class(uuid, uuid, text, text) from public, anon;
revoke execute on function public.child_homework(uuid) from public, anon;
grant execute on function public.can_teach(uuid, uuid, text, text) to authenticated;
grant execute on function public.teaches_class(uuid, uuid, text, text) to authenticated;
grant execute on function public.child_homework(uuid) to authenticated;

-- ------------------------------------------------------ parents' counts ---

alter table public.parent_seen drop constraint parent_seen_section_check;
alter table public.parent_seen add constraint parent_seen_section_check
  check (section in ('fees', 'results', 'notes', 'homework', 'requests'));

create or replace function public.parent_unread()
returns table (student_id uuid, section text, unread bigint, seen_at timestamptz)
language sql stable security invoker set search_path = '' as $$
  with kids as (
    select s.id from public.students s where public.is_parent_of(s.id)
  ),
  sections as (
    select k.id as student_id, x.section, ps.seen_at
    from kids k
    cross join (values ('fees'), ('results'), ('notes'), ('homework'), ('requests')) as x (section)
    left join public.parent_seen ps
      on ps.student_id = k.id and ps.section = x.section and ps.phone = public.current_phone()
  )
  select
    s.student_id,
    s.section,
    case s.section
      when 'notes' then (
        select count(*) from public.student_notes n
        where n.student_id = s.student_id and n.shared_with_parents
          and n.updated_at > coalesce(s.seen_at, '-infinity'))
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
        select count(*) from public.parent_requests q
        where q.student_id = s.student_id and q.handled_at is not null
          and q.handled_at > coalesce(s.seen_at, '-infinity'))
    end,
    s.seen_at
  from sections s
$$;
