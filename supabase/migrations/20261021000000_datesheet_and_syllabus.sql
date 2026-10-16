-- Datesheet (exam schedule) and syllabus (topics covered), per class. A
-- teacher (or admin) sets it for a class or a section, the same way as
-- homework; parents see their child's. No edit once posted, same as
-- homework — remove and re-add to correct a mistake.

-- --------------------------------------------------------- datesheet ---

create table public.datesheets (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  session_id uuid not null,
  class text not null,
  section text, -- null = every section of the class
  exam_name text not null check (length(trim(exam_name)) between 1 and 80),
  subject text not null check (length(trim(subject)) between 1 and 80),
  exam_date date not null,
  start_time text check (length(start_time) <= 20),
  notes text check (length(notes) <= 500),
  created_by text not null default public.current_email(),
  author_name text check (length(author_name) <= 120),
  created_at timestamptz not null default now(),
  foreign key (session_id, school_id) references public.academic_sessions (id, school_id) on delete cascade
);

create index datesheets_class on public.datesheets (school_id, session_id, class, exam_date);

create function public.datesheet_author() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  select coalesce(nullif(trim(m.full_name), ''), split_part(m.email, '@', 1)) into new.author_name
  from public.school_members m
  where m.school_id = new.school_id and m.email = new.created_by;
  new.section := nullif(trim(new.section), '');
  new.exam_name := trim(new.exam_name);
  new.subject := trim(new.subject);
  return new;
end
$$;

revoke execute on function public.datesheet_author() from public, anon, authenticated;

create trigger datesheet_author before insert on public.datesheets
  for each row execute function public.datesheet_author();

alter table public.datesheets enable row level security;
grant select, insert, delete on public.datesheets to authenticated;

create policy "staff of the class read datesheet" on public.datesheets
  for select to authenticated using (public.teaches_class(school_id, session_id, class, section));
create policy "teachers of the class set datesheet" on public.datesheets
  for insert to authenticated with check (
    public.can_teach(school_id, session_id, class, section) and created_by = public.current_email()
  );
create policy "writers or admins remove datesheet" on public.datesheets
  for delete to authenticated using (created_by = public.current_email() or public.is_school_admin(school_id));

-- One child's exam schedule (their class and section this session). For
-- their parents and for staff who can see them.
create function public.child_datesheet(student uuid)
returns table (id uuid, exam_name text, subject text, exam_date date, start_time text, notes text, author_name text, created_at timestamptz, class text, section text)
language sql stable security definer set search_path = '' as $$
  select d.id, d.exam_name, d.subject, d.exam_date, d.start_time, d.notes, d.author_name, d.created_at, d.class, d.section
  from public.student_enrolments e
  join public.academic_sessions a on a.id = e.session_id
  join public.datesheets d on d.session_id = e.session_id and d.class = e.class and (d.section is null or d.section = e.section)
  where e.student_id = student
    and (public.is_parent_of(student) or public.can_see_student(student))
    and e.session_id = (
      select e2.session_id from public.student_enrolments e2
      join public.academic_sessions a2 on a2.id = e2.session_id
      where e2.student_id = student order by a2.name desc limit 1
    )
  order by d.exam_date asc
$$;

revoke execute on function public.child_datesheet(uuid) from public, anon;
grant execute on function public.child_datesheet(uuid) to authenticated;

-- ----------------------------------------------------------- syllabus ---

create table public.syllabus (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  session_id uuid not null,
  class text not null,
  section text,
  subject text not null check (length(trim(subject)) between 1 and 80),
  body text not null check (length(trim(body)) between 1 and 4000),
  created_by text not null default public.current_email(),
  author_name text check (length(author_name) <= 120),
  created_at timestamptz not null default now(),
  foreign key (session_id, school_id) references public.academic_sessions (id, school_id) on delete cascade
);

create index syllabus_class on public.syllabus (school_id, session_id, class, subject);

create function public.syllabus_author() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  select coalesce(nullif(trim(m.full_name), ''), split_part(m.email, '@', 1)) into new.author_name
  from public.school_members m
  where m.school_id = new.school_id and m.email = new.created_by;
  new.section := nullif(trim(new.section), '');
  new.subject := trim(new.subject);
  return new;
end
$$;

revoke execute on function public.syllabus_author() from public, anon, authenticated;

create trigger syllabus_author before insert on public.syllabus
  for each row execute function public.syllabus_author();

alter table public.syllabus enable row level security;
grant select, insert, delete on public.syllabus to authenticated;

create policy "staff of the class read syllabus" on public.syllabus
  for select to authenticated using (public.teaches_class(school_id, session_id, class, section));
create policy "teachers of the class set syllabus" on public.syllabus
  for insert to authenticated with check (
    public.can_teach(school_id, session_id, class, section) and created_by = public.current_email()
  );
create policy "writers or admins remove syllabus" on public.syllabus
  for delete to authenticated using (created_by = public.current_email() or public.is_school_admin(school_id));

-- One child's syllabus (their class and section this session). For their
-- parents and for staff who can see them.
create function public.child_syllabus(student uuid)
returns table (id uuid, subject text, body text, author_name text, created_at timestamptz, class text, section text)
language sql stable security definer set search_path = '' as $$
  select y.id, y.subject, y.body, y.author_name, y.created_at, y.class, y.section
  from public.student_enrolments e
  join public.academic_sessions a on a.id = e.session_id
  join public.syllabus y on y.session_id = e.session_id and y.class = e.class and (y.section is null or y.section = e.section)
  where e.student_id = student
    and (public.is_parent_of(student) or public.can_see_student(student))
    and e.session_id = (
      select e2.session_id from public.student_enrolments e2
      join public.academic_sessions a2 on a2.id = e2.session_id
      where e2.student_id = student order by a2.name desc limit 1
    )
  order by y.subject asc
$$;

revoke execute on function public.child_syllabus(uuid) from public, anon;
grant execute on function public.child_syllabus(uuid) to authenticated;

-- ------------------------------------------------------ parents' counts ---
-- One "datesheet" badge covers both the exam schedule and the syllabus —
-- they're shown together in the parent app.

alter table public.parent_seen drop constraint parent_seen_section_check;
alter table public.parent_seen add constraint parent_seen_section_check
  check (section in ('fees', 'results', 'notes', 'homework', 'requests', 'inbox', 'notices', 'datesheet'));

create or replace function public.parent_unread()
returns table (student_id uuid, section text, unread bigint, seen_at timestamptz)
language sql stable security invoker set search_path = '' as $$
  with kids as (
    select s.id, s.school_id from public.students s where public.is_parent_of(s.id)
  ),
  sections as (
    select k.id as student_id, k.school_id, x.section, ps.seen_at
    from kids k
    cross join (values ('fees'), ('results'), ('homework'), ('inbox'), ('notices'), ('datesheet')) as x (section)
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
      when 'notices' then (
        select count(*) from public.notices n
        where n.school_id = s.school_id and n.for_parents
          and n.created_at > coalesce(s.seen_at, '-infinity'))
      when 'datesheet' then (
        select count(*) from public.child_datesheet(s.student_id) d
        where d.created_at > coalesce(s.seen_at, '-infinity'))
        + (
        select count(*) from public.child_syllabus(s.student_id) y
        where y.created_at > coalesce(s.seen_at, '-infinity'))
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
