-- Fuller profiles for staff (admins and teachers), students and parents:
-- auto IDs per school (ADM-001, TCH-001, STF-001, STU-0001, PAR-0001),
-- Aadhaar or PAN (last 4 only, like students), emergency contact,
-- qualification and subjects for staff, and email, address and photo for
-- parents. Admins get a staff record too, so their profile has a home.

-- ------------------------------------------------------------------ IDs ---

create function public.next_ref(school uuid, kind text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  n bigint;
begin
  insert into public.school_counters (school_id, name, value) values (school, 'ref:' || kind, 1)
  on conflict (school_id, name) do update set value = public.school_counters.value + 1
  returning value into n;
  return kind || '-' || lpad(n::text, case when kind in ('STU', 'PAR') then 4 else 3 end, '0');
end
$$;

revoke execute on function public.next_ref(uuid, text) from public, anon, authenticated;

-- Staff ID prefix: ADM for owners, admins and the principal, TCH for
-- teachers, STF for staff without app access.
create function public.staff_ref_kind(school uuid, mail text) returns text
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select case when m.role = 'teacher' then 'TCH' else 'ADM' end
     from public.school_members m where m.school_id = school and m.email = lower(mail)),
    'STF')
$$;

revoke execute on function public.staff_ref_kind(uuid, text) from public, anon, authenticated;

-- ------------------------------------------------------------ columns ---

alter table public.employees
  add column ref_no text,
  add column id_type text check (id_type in ('aadhaar', 'pan')),
  add column id_last4 text check (id_last4 ~ '^[0-9A-Z]{4}$'),
  add column emergency_name text check (length(emergency_name) <= 120),
  add column emergency_phone text check (length(emergency_phone) <= 20),
  add column qualification text check (length(qualification) <= 200),
  add column subjects text check (length(subjects) <= 200);

alter table public.students add column ref_no text;

alter table public.guardians
  add column ref_no text,
  add column email text check (length(email) <= 200),
  add column id_type text check (id_type in ('aadhaar', 'pan')),
  add column id_last4 text check (id_last4 ~ '^[0-9A-Z]{4}$'),
  add column address text check (length(address) <= 300),
  add column photo_path text;

-- ------------------------------------------- staff records for admins ---
-- Admins, principals and owners join as staff records too (teachers
-- already did). Same rules as before for teachers.

create or replace function public.member_to_employee() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  emp uuid;
  mobile text := right(regexp_replace(coalesce(new.phone, ''), '\D', '', 'g'), 10);
  placeholder text := split_part(new.email, '@', 1);
  photo text;
  joining boolean := tg_op = 'INSERT';
  default_designation text := case new.role when 'teacher' then 'Teacher' when 'principal' then 'Principal' else 'Admin' end;
begin
  select r.photo_path into photo
  from public.access_requests r
  where r.school_id = new.school_id and r.email = new.email and r.photo_path is not null
  order by r.created_at desc
  limit 1;

  select e.id into emp
  from public.employees e
  where e.school_id = new.school_id
    and (lower(e.email) = new.email
      or (length(mobile) = 10 and right(regexp_replace(coalesce(e.phone, ''), '\D', '', 'g'), 10) = mobile))
  order by (lower(e.email) = new.email) desc nulls last
  limit 1;

  if emp is null then
    insert into public.employees (school_id, name, designation, phone, email, joining_date, status, photo_path)
    values (
      new.school_id,
      coalesce(nullif(trim(new.full_name), ''), placeholder),
      coalesce(nullif(trim(new.designation), ''), default_designation),
      nullif(trim(new.phone), ''),
      new.email,
      current_date,
      'active',
      photo
    );
  elsif joining then
    update public.employees e set
      email = coalesce(e.email, new.email),
      name = coalesce(nullif(trim(new.full_name), ''), e.name),
      designation = coalesce(nullif(trim(new.designation), ''), e.designation),
      phone = coalesce(nullif(trim(new.phone), ''), e.phone),
      photo_path = coalesce(photo, e.photo_path),
      status = 'active'
    where e.id = emp;
  else
    update public.employees e set
      email = coalesce(e.email, new.email),
      phone = coalesce(e.phone, nullif(trim(new.phone), '')),
      designation = coalesce(e.designation, nullif(trim(new.designation), '')),
      name = case when e.name = placeholder and nullif(trim(new.full_name), '') is not null then trim(new.full_name) else e.name end,
      photo_path = coalesce(e.photo_path, photo),
      status = case when e.status = 'left' then e.status else 'active' end
    where e.id = emp;
  end if;
  return new;
end
$$;

-- Existing owners, admins and principals without a staff record get one
insert into public.employees (school_id, name, designation, phone, email, joining_date, status)
select
  m.school_id,
  coalesce(nullif(trim(m.full_name), ''), split_part(m.email, '@', 1)),
  coalesce(nullif(trim(m.designation), ''), case m.role when 'principal' then 'Principal' else 'Admin' end),
  nullif(trim(m.phone), ''),
  m.email,
  m.created_at::date,
  'active'
from public.school_members m
where m.role <> 'teacher'
  and not exists (select 1 from public.employees e where e.school_id = m.school_id and lower(e.email) = m.email);

-- --------------------------------------------- new rows get their IDs ---

create function public.assign_ref_no() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.ref_no is null then
    new.ref_no := public.next_ref(
      new.school_id,
      case tg_table_name
        when 'students' then 'STU'
        when 'guardians' then 'PAR'
        else public.staff_ref_kind(new.school_id, (to_jsonb(new) ->> 'email'))
      end
    );
  end if;
  return new;
end
$$;

revoke execute on function public.assign_ref_no() from public, anon, authenticated;

create trigger employees_ref_no before insert on public.employees for each row execute function public.assign_ref_no();
create trigger students_ref_no before insert on public.students for each row execute function public.assign_ref_no();
create trigger guardians_ref_no before insert on public.guardians for each row execute function public.assign_ref_no();

-- Everyone already here, numbered in the order they were added
do $$
declare
  r record;
begin
  for r in select id, school_id, email from public.employees where ref_no is null order by school_id, created_at, name loop
    update public.employees set ref_no = public.next_ref(r.school_id, public.staff_ref_kind(r.school_id, r.email)) where id = r.id;
  end loop;
  for r in select id, school_id from public.students where ref_no is null order by school_id, created_at, admission_no loop
    update public.students set ref_no = public.next_ref(r.school_id, 'STU') where id = r.id;
  end loop;
  for r in select id, school_id from public.guardians where ref_no is null order by school_id, created_at loop
    update public.guardians set ref_no = public.next_ref(r.school_id, 'PAR') where id = r.id;
  end loop;
end
$$;

create unique index employees_ref_no on public.employees (school_id, ref_no);
create unique index students_ref_no on public.students (school_id, ref_no);
create unique index guardians_ref_no on public.guardians (school_id, ref_no);

-- -------------------------------------------------- staff: my profile ---

drop function public.update_my_profile(uuid, text, text, text);
drop function public.my_staff_record(uuid);

create function public.update_my_profile(
  p_school uuid,
  p_full_name text,
  p_designation text,
  p_phone text,
  p_id_type text,
  p_id_last4 text,
  p_emergency_name text,
  p_emergency_phone text,
  p_qualification text,
  p_subjects text
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  me text := public.current_email();
  last4 text := nullif(upper(trim(coalesce(p_id_last4, ''))), '');
begin
  if me is null or not exists (select 1 from public.school_members m where m.school_id = p_school and m.email = me) then
    raise exception 'not allowed';
  end if;
  if coalesce(trim(p_full_name), '') = '' then
    raise exception 'full name is required';
  end if;
  if coalesce(trim(p_designation), '') = '' then
    raise exception 'designation is required';
  end if;
  if last4 is not null and last4 !~ '^[0-9A-Z]{4}$' then
    raise exception 'only the last 4 characters of the ID';
  end if;

  update public.school_members m set
    full_name = left(trim(p_full_name), 120),
    designation = left(trim(p_designation), 80),
    phone = nullif(left(trim(p_phone), 20), '')
  where m.school_id = p_school and m.email = me;

  update public.employees e set
    name = left(trim(p_full_name), 120),
    designation = left(trim(p_designation), 80),
    phone = nullif(left(trim(p_phone), 20), ''),
    id_type = case when last4 is null then null else nullif(p_id_type, '') end,
    id_last4 = last4,
    emergency_name = nullif(left(trim(p_emergency_name), 120), ''),
    emergency_phone = nullif(left(trim(p_emergency_phone), 20), ''),
    qualification = nullif(left(trim(p_qualification), 200), ''),
    subjects = nullif(left(trim(p_subjects), 200), '')
  where e.school_id = p_school and lower(e.email) = me and e.status <> 'left';
end
$$;

revoke execute on function public.update_my_profile(uuid, text, text, text, text, text, text, text, text, text) from public, anon;
grant execute on function public.update_my_profile(uuid, text, text, text, text, text, text, text, text, text) to authenticated;

create function public.my_staff_record(p_school uuid)
returns table (
  id uuid, ref_no text, name text, designation text, phone text, photo_path text, joining_date date, status text,
  id_type text, id_last4 text, emergency_name text, emergency_phone text, qualification text, subjects text
)
language sql stable security definer set search_path = '' as $$
  select e.id, e.ref_no, e.name, e.designation, e.phone, e.photo_path, e.joining_date, e.status,
         e.id_type, e.id_last4, e.emergency_name, e.emergency_phone, e.qualification, e.subjects
  from public.employees e
  where e.school_id = p_school and lower(e.email) = public.current_email() and e.status <> 'left'
  limit 1
$$;

revoke execute on function public.my_staff_record(uuid) from public, anon;
grant execute on function public.my_staff_record(uuid) to authenticated;

-- ----------------------------------------------- parents: my profile ---

-- A parent's own details (one row per school they're in), with each
-- linked child and how they're related.
create function public.my_guardian_profile()
returns table (
  id uuid, school_id uuid, ref_no text, name text, phone text, email text,
  id_type text, id_last4 text, address text, photo_path text, children jsonb
)
language sql stable security definer set search_path = '' as $$
  select g.id, g.school_id, g.ref_no, g.name, g.phone, g.email, g.id_type, g.id_last4, g.address, g.photo_path,
    coalesce((
      select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'relation', gs.relation, 'admission_no', s.admission_no) order by s.name)
      from public.guardian_students gs join public.students s on s.id = gs.student_id
      where gs.guardian_id = g.id and not gs.removed and s.status <> 'left'
    ), '[]'::jsonb)
  from public.guardians g
  where g.phone = public.current_phone()
  order by g.created_at
$$;

revoke execute on function public.my_guardian_profile() from public, anon;
grant execute on function public.my_guardian_profile() to authenticated;

-- Their name, email, ID (last 4) and address, the same in every school
create function public.update_my_guardian(p_name text, p_email text, p_id_type text, p_id_last4 text, p_address text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  me text := public.current_phone();
  last4 text := nullif(upper(trim(coalesce(p_id_last4, ''))), '');
begin
  if me is null then
    raise exception 'not allowed';
  end if;
  if last4 is not null and last4 !~ '^[0-9A-Z]{4}$' then
    raise exception 'only the last 4 characters of the ID';
  end if;
  update public.guardians g set
    name = coalesce(nullif(left(trim(p_name), 120), ''), g.name),
    email = nullif(lower(left(trim(p_email), 200)), ''),
    id_type = case when last4 is null then null else nullif(p_id_type, '') end,
    id_last4 = last4,
    address = nullif(left(trim(p_address), 300), ''),
    updated_at = now(),
    updated_by = me
  where g.phone = me;
end
$$;

revoke execute on function public.update_my_guardian(text, text, text, text, text) from public, anon;
grant execute on function public.update_my_guardian(text, text, text, text, text) to authenticated;

-- Photos: staff write their own staff photo (as before); parents write
-- <school>/guardians/<their guardian id>(-<time>).jpg.
create or replace function public.can_write_photo(object_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select case
    when object_name ~ '^[0-9a-f-]{36}/students/[0-9a-f-]{36}(-[0-9]{1,20})?\.jpg$' then
      exists (
        select 1 from public.students s
        where s.school_id::text = split_part(object_name, '/', 1)
          and s.id::text = left(split_part(object_name, '/', 3), 36)
          and public.can_see_student(s.id)
      )
    when object_name ~ '^[0-9a-f-]{36}/employees/[0-9a-f-]{36}(-[0-9]{1,20})?\.jpg$' then
      public.is_admin_folder(object_name) or exists (
        select 1 from public.employees e
        where e.school_id::text = split_part(object_name, '/', 1)
          and e.id::text = left(split_part(object_name, '/', 3), 36)
          and lower(e.email) = public.current_email()
      )
    when object_name ~ '^[0-9a-f-]{36}/guardians/[0-9a-f-]{36}(-[0-9]{1,20})?\.jpg$' then
      public.is_admin_folder(object_name) or exists (
        select 1 from public.guardians g
        where g.school_id::text = split_part(object_name, '/', 1)
          and g.id::text = left(split_part(object_name, '/', 3), 36)
          and g.phone = public.current_phone()
      )
    else public.is_admin_folder(object_name)
  end
$$;

-- Parents see their own photo (staff see it as a school photo already)
create function public.is_own_guardian_photo(object_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.guardians g where g.photo_path = object_name and g.phone = public.current_phone())
$$;

revoke execute on function public.is_own_guardian_photo(text) from public, anon;
grant execute on function public.is_own_guardian_photo(text) to authenticated;

create policy "parents read their own photo" on storage.objects
  for select to authenticated using (bucket_id = 'photos' and public.is_own_guardian_photo(name));

create function public.set_my_guardian_photo(p_school uuid, p_path text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  me text := public.current_phone();
  gid uuid;
begin
  select g.id into gid from public.guardians g where g.school_id = p_school and g.phone = me;
  if gid is null
     or p_path !~ ('^' || p_school::text || '/guardians/' || gid::text || '(-[0-9]{1,20})?\.jpg$')
     or not exists (select 1 from storage.objects o where o.bucket_id = 'photos' and o.name = p_path) then
    raise exception 'not allowed';
  end if;
  -- The same photo in every school they're in
  update public.guardians set photo_path = p_path, updated_at = now() where phone = me;
end
$$;

revoke execute on function public.set_my_guardian_photo(uuid, text) from public, anon;
grant execute on function public.set_my_guardian_photo(uuid, text) to authenticated;
