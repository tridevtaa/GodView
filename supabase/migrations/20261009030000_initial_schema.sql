-- GodView: multi-school schema.
--
-- Every row belongs to a school (school_id). Row Level Security lets a signed-in
-- user see and change a school's rows only if their verified email is listed in
-- school_members for that school. Child tables carry school_id too, tied to the
-- parent with composite foreign keys, so a row can never point at another
-- school's student or session.

-- ---------------------------------------------------------------- schools ---

create table public.schools (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9-]{2,40}$'),
  name text not null,
  created_at timestamptz not null default now()
);

create type public.member_role as enum ('owner', 'admin', 'staff');

create table public.school_members (
  school_id uuid not null references public.schools (id) on delete cascade,
  email text not null check (email = lower(email)),
  role public.member_role not null default 'staff',
  added_by text,
  created_at timestamptz not null default now(),
  primary key (school_id, email)
);

-- ---------------------------------------------------------- access helpers ---

-- The caller's email, lowercased, only once it is verified (Google sign-ins are).
create function public.current_email() returns text
language sql stable security definer set search_path = '' as $$
  select lower(u.email)
  from auth.users u
  where u.id = auth.uid() and u.email_confirmed_at is not null
$$;

create function public.is_member(school uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.school_members m
    where m.school_id = school and m.email = public.current_email()
  )
$$;

create function public.is_school_admin(school uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.school_members m
    where m.school_id = school
      and m.email = public.current_email()
      and m.role in ('owner', 'admin')
  )
$$;

-- For storage paths "<school_id>/...": compares as text, so a malformed path is
-- simply refused instead of raising a uuid cast error.
create function public.is_member_folder(object_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.school_members m
    where m.school_id::text = (storage.foldername(object_name))[1]
      and m.email = public.current_email()
  )
$$;

revoke execute on function public.current_email() from public, anon;
revoke execute on function public.is_member(uuid) from public, anon;
revoke execute on function public.is_school_admin(uuid) from public, anon;
grant execute on function public.current_email() to authenticated;
grant execute on function public.is_member(uuid) to authenticated;
grant execute on function public.is_school_admin(uuid) to authenticated;
revoke execute on function public.is_member_folder(text) from public, anon;
grant execute on function public.is_member_folder(text) to authenticated;

-- updated_at / updated_by on every write; clients use updated_at to fetch only
-- what changed since their last visit.
create function public.touch() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  new.updated_by := coalesce(public.current_email(), new.updated_by);
  return new;
end
$$;

-- -------------------------------------------------------------- sessions ---

create table public.academic_sessions (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  name text not null check (name ~ '^\d{4}-\d{2}$'), -- e.g. 2026-27
  starts_on date,
  ends_on date,
  created_at timestamptz not null default now(),
  unique (school_id, name),
  unique (id, school_id)
);

-- -------------------------------------------------------------- students ---

create table public.students (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  admission_no text not null,
  name text not null,
  gender text not null default '' check (gender in ('', 'F', 'M')),
  dob date,
  father_name text,
  mother_name text,
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
  -- Only the last 4 digits: full Aadhaar numbers need a regulated vault.
  aadhaar_last4 text check (aadhaar_last4 ~ '^\d{4}$'),
  admission_date date,
  admission_type text,
  admission_category text,
  pickup_point text,
  transport_route text,
  remarks text,
  status text not null default 'active' check (status in ('active', 'inactive', 'left')),
  left_on date,
  photo_path text, -- object in the private "photos" bucket
  photo_url text, -- external photo (e.g. from the ERP)
  legacy_id text, -- Firestore document id, kept for the migration
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by text,
  unique (school_id, admission_no),
  unique (id, school_id)
);

create index students_school_updated on public.students (school_id, updated_at);

create trigger students_touch before insert or update on public.students
  for each row execute function public.touch();

-- One row per student per session: class, section and status that year.
create table public.student_enrolments (
  student_id uuid not null,
  session_id uuid not null,
  school_id uuid not null references public.schools (id) on delete cascade,
  class text not null,
  section text,
  stream text,
  roll_no text,
  status text not null default 'active' check (status in ('active', 'inactive', 'left')),
  updated_at timestamptz not null default now(),
  updated_by text,
  primary key (student_id, session_id),
  foreign key (student_id, school_id) references public.students (id, school_id) on delete cascade,
  foreign key (session_id, school_id) references public.academic_sessions (id, school_id) on delete cascade
);

create index student_enrolments_school_updated on public.student_enrolments (school_id, updated_at);

create trigger student_enrolments_touch before insert or update on public.student_enrolments
  for each row execute function public.touch();

-- Dues as reported by the school's fee system, per student per session.
create table public.fee_dues (
  student_id uuid not null,
  session_id uuid not null,
  school_id uuid not null references public.schools (id) on delete cascade,
  status text not null check (status in ('paid', 'due', 'overdue')),
  amount numeric(12, 2) not null default 0 check (amount >= 0),
  months text[] not null default '{}',
  breakdown jsonb not null default '{}',
  as_of date not null,
  updated_at timestamptz not null default now(),
  updated_by text,
  primary key (student_id, session_id),
  foreign key (student_id, school_id) references public.students (id, school_id) on delete cascade,
  foreign key (session_id, school_id) references public.academic_sessions (id, school_id) on delete cascade
);

create trigger fee_dues_touch before insert or update on public.fee_dues
  for each row execute function public.touch();

-- ------------------------------------------------------------- employees ---

create table public.employees (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  employee_no text,
  name text not null,
  designation text,
  department text,
  phone text,
  email text,
  joining_date date,
  status text not null default 'active' check (status in ('active', 'inactive', 'left')),
  photo_path text,
  legacy_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by text,
  unique (school_id, employee_no)
);

create index employees_school_updated on public.employees (school_id, updated_at);

create trigger employees_touch before insert or update on public.employees
  for each row execute function public.touch();

-- ------------------------------------------------------------------- RLS ---

alter table public.schools enable row level security;
alter table public.school_members enable row level security;
alter table public.academic_sessions enable row level security;
alter table public.students enable row level security;
alter table public.student_enrolments enable row level security;
alter table public.fee_dues enable row level security;
alter table public.employees enable row level security;

-- Schools are created and named by GodView, not from the app.
create policy "members read their school" on public.schools
  for select to authenticated using (public.is_member(id));

create policy "members see colleagues" on public.school_members
  for select to authenticated using (public.is_member(school_id));
create policy "admins add members" on public.school_members
  for insert to authenticated with check (public.is_school_admin(school_id) and role <> 'owner');
create policy "admins change members" on public.school_members
  for update to authenticated using (public.is_school_admin(school_id) and role <> 'owner')
  with check (public.is_school_admin(school_id) and role <> 'owner');
create policy "admins remove members" on public.school_members
  for delete to authenticated using (public.is_school_admin(school_id) and role <> 'owner');

create policy "members read sessions" on public.academic_sessions
  for select to authenticated using (public.is_member(school_id));
create policy "admins manage sessions" on public.academic_sessions
  for all to authenticated using (public.is_school_admin(school_id))
  with check (public.is_school_admin(school_id));

create policy "members read students" on public.students
  for select to authenticated using (public.is_member(school_id));
create policy "members add students" on public.students
  for insert to authenticated with check (public.is_member(school_id));
create policy "members edit students" on public.students
  for update to authenticated using (public.is_member(school_id))
  with check (public.is_member(school_id));
create policy "admins delete students" on public.students
  for delete to authenticated using (public.is_school_admin(school_id));

create policy "members manage enrolments" on public.student_enrolments
  for all to authenticated using (public.is_member(school_id))
  with check (public.is_member(school_id));

create policy "members manage fee dues" on public.fee_dues
  for all to authenticated using (public.is_member(school_id))
  with check (public.is_member(school_id));

create policy "members read employees" on public.employees
  for select to authenticated using (public.is_member(school_id));
create policy "members add employees" on public.employees
  for insert to authenticated with check (public.is_member(school_id));
create policy "members edit employees" on public.employees
  for update to authenticated using (public.is_member(school_id))
  with check (public.is_member(school_id));
create policy "admins delete employees" on public.employees
  for delete to authenticated using (public.is_school_admin(school_id));

-- New tables aren't exposed automatically on this project, so grant explicitly.
-- Nothing is granted to anon: every table needs a signed-in member.
revoke all on all tables in schema public from anon;
grant select on public.schools to authenticated;
grant select, insert, update, delete on public.school_members to authenticated;
grant select, insert, update, delete on public.academic_sessions to authenticated;
grant select, insert, update, delete on public.students to authenticated;
grant select, insert, update, delete on public.student_enrolments to authenticated;
grant select, insert, update, delete on public.fee_dues to authenticated;
grant select, insert, update, delete on public.employees to authenticated;

-- ---------------------------------------------------------------- photos ---

-- Private bucket; objects live at "<school_id>/<file>". Small images only.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', false, 512000, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy "members read school photos" on storage.objects
  for select to authenticated
  using (bucket_id = 'photos' and public.is_member_folder(name));
create policy "members upload school photos" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'photos' and public.is_member_folder(name));
create policy "members replace school photos" on storage.objects
  for update to authenticated
  using (bucket_id = 'photos' and public.is_member_folder(name));
create policy "members delete school photos" on storage.objects
  for delete to authenticated
  using (bucket_id = 'photos' and public.is_member_folder(name));
