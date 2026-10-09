-- Roles: owner, admin, teacher.
--
--   owner   everything, and the only role that manages users (members, class
--           assignments, access requests) and approves admins' exports
--   admin   everything else: students incl. personal details, imports, fees,
--           employees, sessions; exports need an owner-approved request
--   teacher only students enrolled in their assigned class/section for a
--           session, without personal details; may change photos, add notes
--           and enter exam results for those students
--
-- Personal details move out of `students` into `student_private`, readable
-- by owners and admins only, so teachers can't fetch them even via the API.

-- ------------------------------------------------------------------ roles ---

alter type public.member_role rename value 'staff' to 'teacher';
alter table public.school_members alter column role set default 'teacher';

create function public.is_owner(school uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.school_members m
    where m.school_id = school and m.email = public.current_email() and m.role = 'owner'
  )
$$;

-- ------------------------------------------------- teacher class assignments ---

create table public.teacher_classes (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  email text not null check (email = lower(email)),
  session_id uuid not null,
  class text not null,
  section text, -- null = every section of the class
  created_at timestamptz not null default now(),
  foreign key (session_id, school_id) references public.academic_sessions (id, school_id) on delete cascade,
  foreign key (school_id, email) references public.school_members (school_id, email) on delete cascade
);

create unique index teacher_classes_unique
  on public.teacher_classes (school_id, email, session_id, class, coalesce(section, ''));

-- True if the caller may see this student: an owner/admin of the student's
-- school, or a teacher assigned to a class/section the student is enrolled in.
create function public.can_see_student(student uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.students s
    where s.id = student and public.is_school_admin(s.school_id)
  ) or exists (
    select 1
    from public.student_enrolments e
    join public.teacher_classes t
      on t.school_id = e.school_id
     and t.session_id = e.session_id
     and t.class = e.class
     and (t.section is null or t.section = e.section)
    where e.student_id = student
      and t.email = public.current_email()
      and exists (
        select 1 from public.school_members m
        where m.school_id = t.school_id and m.email = t.email
      )
  )
$$;

-- ------------------------------------------------- personal details split ---

create table public.student_private (
  student_id uuid primary key,
  school_id uuid not null references public.schools (id) on delete cascade,
  parent_phone text,
  father_phone text,
  mother_phone text,
  email text,
  address text,
  city text,
  state text,
  category text,
  religion text,
  srn text,
  aadhaar_last4 text check (aadhaar_last4 ~ '^\d{4}$'),
  admission_category text,
  transport_route text,
  pickup_point text,
  updated_at timestamptz not null default now(),
  updated_by text,
  foreign key (student_id, school_id) references public.students (id, school_id) on delete cascade
);

insert into public.student_private (
  student_id, school_id, parent_phone, father_phone, mother_phone, email, address, city, state,
  category, religion, srn, aadhaar_last4, admission_category, transport_route, pickup_point
)
select
  id, school_id, parent_phone, father_phone, mother_phone, email, address, city, state,
  category, religion, srn, aadhaar_last4, admission_category, transport_route, pickup_point
from public.students;

alter table public.students
  drop column parent_phone,
  drop column father_phone,
  drop column mother_phone,
  drop column email,
  drop column address,
  drop column city,
  drop column state,
  drop column category,
  drop column religion,
  drop column srn,
  drop column aadhaar_last4,
  drop column admission_category,
  drop column transport_route,
  drop column pickup_point;

create trigger student_private_touch before insert or update on public.student_private
  for each row execute function public.touch();

-- ---------------------------------------------------- notes and results ---

create table public.student_notes (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  student_id uuid not null,
  body text not null check (length(body) between 1 and 4000),
  author_email text not null default public.current_email(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by text,
  foreign key (student_id, school_id) references public.students (id, school_id) on delete cascade
);

create index student_notes_student on public.student_notes (student_id, created_at desc);

create trigger student_notes_touch before insert or update on public.student_notes
  for each row execute function public.touch();

create table public.exam_results (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  session_id uuid not null,
  student_id uuid not null,
  exam text not null check (length(exam) between 1 and 80), -- e.g. "Term 1"
  subject text not null check (length(subject) between 1 and 80),
  marks numeric(6, 2) check (marks >= 0),
  max_marks numeric(6, 2) check (max_marks > 0),
  grade text,
  remarks text,
  entered_by text not null default public.current_email(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by text,
  check (marks is null or max_marks is null or marks <= max_marks),
  unique (student_id, session_id, exam, subject),
  foreign key (student_id, school_id) references public.students (id, school_id) on delete cascade,
  foreign key (session_id, school_id) references public.academic_sessions (id, school_id) on delete cascade
);

create trigger exam_results_touch before insert or update on public.exam_results
  for each row execute function public.touch();

-- ------------------------------------------------------- access requests ---

-- Someone who signs in without membership asks to join a school by its code
-- (slug). Only that school's owner sees and decides requests.
create table public.access_requests (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  email text not null check (email = lower(email)),
  name text,
  message text check (length(message) <= 500),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  decided_by text,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index access_requests_one_pending
  on public.access_requests (school_id, email) where status = 'pending';

-- Doesn't reveal whether a school code exists: unknown codes just do nothing.
create function public.request_access(school_code text, display_name text, note text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  me text := public.current_email();
  school uuid;
begin
  if me is null then
    raise exception 'sign in with a verified email first';
  end if;
  select id into school from public.schools where slug = lower(trim(school_code));
  if school is null then
    return;
  end if;
  if exists (select 1 from public.school_members where school_id = school and email = me) then
    return;
  end if;
  insert into public.access_requests (school_id, email, name, message)
  values (school, me, left(display_name, 120), left(note, 500))
  on conflict (school_id, email) where status = 'pending' do nothing;
end
$$;

-- ------------------------------------------------------- export requests ---

-- Admins ask to export; the owner approves; an approved request allows one
-- export. Owners export directly. (Admins can still view the data they're
-- allowed to see; this governs the Export feature and records who exported.)
create table public.export_requests (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  requested_by text not null default public.current_email(),
  scope text not null default 'students' check (scope in ('students', 'employees', 'results')),
  reason text check (length(reason) <= 500),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'used')),
  decided_by text,
  decided_at timestamptz,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

-- Marks an approved request as used; returns true if the caller may export now.
create function public.use_export_request(request uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  me text := public.current_email();
begin
  update public.export_requests
     set status = 'used', used_at = now()
   where id = request and requested_by = me and status = 'approved'
     and public.is_school_admin(school_id);
  return found;
end
$$;

-- ------------------------------------------------------------- photos ---

-- Lets owners/admins and the student's teachers set the photo without giving
-- teachers update rights on the rest of the student record.
create function public.set_student_photo(student uuid, path text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  school uuid;
begin
  select school_id into school from public.students where id = student;
  if school is null or not public.can_see_student(student) then
    raise exception 'not allowed';
  end if;
  if path is not null and path <> school::text || '/students/' || student::text || '.jpg' then
    raise exception 'unexpected photo path';
  end if;
  update public.students set photo_path = path where id = student;
end
$$;

-- Owner/admin of the school named by the first folder of a storage path
-- (text comparison, so malformed paths are refused rather than erroring).
create function public.is_admin_folder(object_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.school_members m
    where m.school_id::text = split_part(object_name, '/', 1)
      and m.email = public.current_email()
      and m.role in ('owner', 'admin')
  )
$$;

-- Storage write check for "<school>/students/<student>.jpg".
create function public.can_write_photo(object_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select case
    when object_name ~ '^[0-9a-f-]{36}/students/[0-9a-f-]{36}\.jpg$' then
      exists (
        select 1 from public.students s
        where s.school_id::text = split_part(object_name, '/', 1)
          and s.id::text = split_part(split_part(object_name, '/', 3), '.', 1)
          and public.can_see_student(s.id)
      )
    else public.is_admin_folder(object_name)
  end
$$;

-- --------------------------------------------------------------- grants ---

revoke execute on function public.is_owner(uuid) from public, anon;
revoke execute on function public.can_see_student(uuid) from public, anon;
revoke execute on function public.request_access(text, text, text) from public, anon;
revoke execute on function public.use_export_request(uuid) from public, anon;
revoke execute on function public.set_student_photo(uuid, text) from public, anon;
revoke execute on function public.can_write_photo(text) from public, anon;
revoke execute on function public.is_admin_folder(text) from public, anon;
grant execute on function public.is_owner(uuid) to authenticated;
grant execute on function public.can_see_student(uuid) to authenticated;
grant execute on function public.request_access(text, text, text) to authenticated;
grant execute on function public.use_export_request(uuid) to authenticated;
grant execute on function public.set_student_photo(uuid, text) to authenticated;
grant execute on function public.can_write_photo(text) to authenticated;
grant execute on function public.is_admin_folder(text) to authenticated;

grant select, insert, update, delete on public.teacher_classes to authenticated;
grant select, insert, update, delete on public.student_private to authenticated;
grant select, insert, update, delete on public.student_notes to authenticated;
grant select, insert, update, delete on public.exam_results to authenticated;
grant select, update on public.access_requests to authenticated;
grant select, insert, update on public.export_requests to authenticated;

-- ------------------------------------------------------------- policies ---

alter table public.teacher_classes enable row level security;
alter table public.student_private enable row level security;
alter table public.student_notes enable row level security;
alter table public.exam_results enable row level security;
alter table public.access_requests enable row level security;
alter table public.export_requests enable row level security;

-- Members: only the owner manages; owners can't be changed from the app.
drop policy "members see colleagues" on public.school_members;
drop policy "admins add members" on public.school_members;
drop policy "admins change members" on public.school_members;
drop policy "admins remove members" on public.school_members;

create policy "admins see members, others themselves" on public.school_members
  for select to authenticated
  using (public.is_school_admin(school_id) or email = public.current_email());
create policy "owner adds members" on public.school_members
  for insert to authenticated with check (public.is_owner(school_id) and role <> 'owner');
create policy "owner changes members" on public.school_members
  for update to authenticated using (public.is_owner(school_id) and role <> 'owner')
  with check (public.is_owner(school_id) and role <> 'owner');
create policy "owner removes members" on public.school_members
  for delete to authenticated using (public.is_owner(school_id) and role <> 'owner');

create policy "admins see assignments, teachers their own" on public.teacher_classes
  for select to authenticated
  using (public.is_school_admin(school_id) or email = public.current_email());
create policy "owner manages assignments" on public.teacher_classes
  for all to authenticated using (public.is_owner(school_id)) with check (public.is_owner(school_id));

-- Students: teachers only see their classes and can't change records.
drop policy "members read students" on public.students;
drop policy "members add students" on public.students;
drop policy "members edit students" on public.students;

create policy "admins or class teachers read students" on public.students
  for select to authenticated using (public.is_school_admin(school_id) or public.can_see_student(id));
create policy "admins add students" on public.students
  for insert to authenticated with check (public.is_school_admin(school_id));
create policy "admins edit students" on public.students
  for update to authenticated using (public.is_school_admin(school_id))
  with check (public.is_school_admin(school_id));

create policy "admins manage personal details" on public.student_private
  for all to authenticated using (public.is_school_admin(school_id))
  with check (public.is_school_admin(school_id));

drop policy "members manage enrolments" on public.student_enrolments;
create policy "admins or class teachers read enrolments" on public.student_enrolments
  for select to authenticated using (public.is_school_admin(school_id) or public.can_see_student(student_id));
create policy "admins manage enrolments" on public.student_enrolments
  for all to authenticated using (public.is_school_admin(school_id))
  with check (public.is_school_admin(school_id));

drop policy "members manage fee dues" on public.fee_dues;
create policy "admins manage fee dues" on public.fee_dues
  for all to authenticated using (public.is_school_admin(school_id))
  with check (public.is_school_admin(school_id));

drop policy "members read employees" on public.employees;
drop policy "members add employees" on public.employees;
drop policy "members edit employees" on public.employees;
create policy "admins read employees" on public.employees
  for select to authenticated using (public.is_school_admin(school_id));
create policy "admins add employees" on public.employees
  for insert to authenticated with check (public.is_school_admin(school_id));
create policy "admins edit employees" on public.employees
  for update to authenticated using (public.is_school_admin(school_id))
  with check (public.is_school_admin(school_id));

-- Notes: anyone who can see the student reads and adds; authors and admins edit.
create policy "see notes of visible students" on public.student_notes
  for select to authenticated using (public.can_see_student(student_id));
create policy "add notes to visible students" on public.student_notes
  for insert to authenticated
  with check (public.can_see_student(student_id) and author_email = public.current_email());
create policy "authors or admins edit notes" on public.student_notes
  for update to authenticated
  using (author_email = public.current_email() or public.is_school_admin(school_id))
  with check (public.can_see_student(student_id));
create policy "authors or admins delete notes" on public.student_notes
  for delete to authenticated
  using (author_email = public.current_email() or public.is_school_admin(school_id));

create policy "see results of visible students" on public.exam_results
  for select to authenticated using (public.can_see_student(student_id));
create policy "enter results for visible students" on public.exam_results
  for insert to authenticated with check (public.can_see_student(student_id));
create policy "update results for visible students" on public.exam_results
  for update to authenticated using (public.can_see_student(student_id))
  with check (public.can_see_student(student_id));
create policy "enterers or admins delete results" on public.exam_results
  for delete to authenticated
  using (entered_by = public.current_email() or public.is_school_admin(school_id));

create policy "requesters see their own, owner sees school's" on public.access_requests
  for select to authenticated using (email = public.current_email() or public.is_owner(school_id));
create policy "owner decides requests" on public.access_requests
  for update to authenticated using (public.is_owner(school_id)) with check (public.is_owner(school_id));

create policy "admins see own export requests, owner all" on public.export_requests
  for select to authenticated
  using (public.is_owner(school_id) or (requested_by = public.current_email() and public.is_school_admin(school_id)));
create policy "admins request exports" on public.export_requests
  for insert to authenticated
  with check (public.is_school_admin(school_id) and requested_by = public.current_email() and status = 'pending');
create policy "owner decides exports" on public.export_requests
  for update to authenticated using (public.is_owner(school_id)) with check (public.is_owner(school_id));

-- Photos: members of the school read; writes go through can_write_photo.
drop policy "members upload school photos" on storage.objects;
drop policy "members replace school photos" on storage.objects;
drop policy "members delete school photos" on storage.objects;
create policy "allowed users upload photos" on storage.objects
  for insert to authenticated with check (bucket_id = 'photos' and public.can_write_photo(name));
create policy "allowed users replace photos" on storage.objects
  for update to authenticated using (bucket_id = 'photos' and public.can_write_photo(name))
  with check (bucket_id = 'photos' and public.can_write_photo(name));
create policy "admins delete photos" on storage.objects
  for delete to authenticated
  using (bucket_id = 'photos' and public.is_admin_folder(name));
