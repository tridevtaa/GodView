-- Staff profiles they edit themselves, a required designation at signup,
-- and teachers saying which class they're class teacher of.

-- ---------------------------------------------------------- request_access ---
-- Same as before, plus: a designation is required (the signup dropdown:
-- Admin, Principal, Teacher, Other, or what they typed for Other).

create or replace function public.request_access(
  p_code text,
  p_full_name text,
  p_designation text,
  p_phone text,
  p_subjects text,
  p_note text,
  p_photo_path text,
  p_policy_agreed boolean,
  p_id_proof_path text,
  p_address_proof_type text,
  p_address_proof_path text,
  p_education_cert_path text
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  me text := public.current_email();
  uid text := auth.uid()::text;
  school uuid;
  session uuid;
  policy text;
begin
  if me is null then
    raise exception 'sign in with a verified email first';
  end if;
  if coalesce(trim(p_full_name), '') = '' then
    raise exception 'full name is required';
  end if;
  if coalesce(trim(p_designation), '') = '' then
    raise exception 'designation is required';
  end if;
  if p_photo_path is distinct from 'requests/' || uid || '.jpg'
     or not exists (select 1 from storage.objects o where o.bucket_id = 'photos' and o.name = p_photo_path) then
    raise exception 'photo is required';
  end if;

  select s.id into school
  from public.schools s
  where public.normalise_join_code(s.join_code) = public.normalise_join_code(p_code)
    and length(public.normalise_join_code(p_code)) >= 8;
  if school is null then
    return;
  end if;
  if exists (select 1 from public.school_members m where m.school_id = school and m.email = me) then
    return;
  end if;

  select s.staff_policy into policy from public.schools s where s.id = school;
  if policy is not null and trim(policy) <> '' and not coalesce(p_policy_agreed, false) then
    raise exception 'agree to the school policy first';
  end if;

  if p_id_proof_path !~ ('^requests/' || uid || '/id_proof\.[a-z0-9]+$')
     or not exists (select 1 from storage.objects o where o.bucket_id = 'staff-documents' and o.name = p_id_proof_path) then
    raise exception 'id proof is required';
  end if;
  if p_address_proof_type is null or p_address_proof_type not in ('aadhaar', 'pan', 'dl', 'passport', 'voter_id', 'other') then
    raise exception 'address proof type is required';
  end if;
  if p_address_proof_path !~ ('^requests/' || uid || '/address_proof\.[a-z0-9]+$')
     or not exists (select 1 from storage.objects o where o.bucket_id = 'staff-documents' and o.name = p_address_proof_path) then
    raise exception 'address proof is required';
  end if;
  if p_education_cert_path !~ ('^requests/' || uid || '/education_cert\.[a-z0-9]+$')
     or not exists (select 1 from storage.objects o where o.bucket_id = 'staff-documents' and o.name = p_education_cert_path) then
    raise exception 'education or employment certificate is required';
  end if;

  select a.id into session
  from public.academic_sessions a
  where a.school_id = school
  order by (current_date between coalesce(a.starts_on, '-infinity') and coalesce(a.ends_on, 'infinity')) desc, a.name desc
  limit 1;

  insert into public.access_requests
    (school_id, email, name, designation, phone, subjects, message, session_id, photo_path,
     policy_agreed_at, id_proof_path, address_proof_type, address_proof_path, education_cert_path)
  values (
    school, me, left(trim(p_full_name), 120), left(trim(p_designation), 80), left(trim(p_phone), 20),
    left(trim(p_subjects), 200), left(trim(p_note), 500), session, p_photo_path,
    case when coalesce(p_policy_agreed, false) then now() else null end,
    p_id_proof_path, p_address_proof_type, p_address_proof_path, p_education_cert_path
  )
  on conflict (school_id, email) where status = 'pending' do update set
    name = excluded.name,
    designation = excluded.designation,
    phone = excluded.phone,
    subjects = excluded.subjects,
    message = excluded.message,
    session_id = excluded.session_id,
    photo_path = excluded.photo_path,
    policy_agreed_at = excluded.policy_agreed_at,
    id_proof_path = excluded.id_proof_path,
    address_proof_type = excluded.address_proof_type,
    address_proof_path = excluded.address_proof_path,
    education_cert_path = excluded.education_cert_path,
    created_at = now();
end
$$;

-- ------------------------------------------------ class requests: in charge ---
-- Each picked class can carry in_charge: true (the teacher is its class
-- teacher). Kept through the request; on approval it makes them class
-- teacher, unless that class already has one.

create or replace function public.request_class_allocation(p_school_id uuid, p_classes jsonb, p_subjects text, p_note text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  me text := public.current_email();
  session uuid;
  picked jsonb;
begin
  if not exists (
    select 1 from public.school_members m
    where m.school_id = p_school_id and m.email = me and m.role = 'teacher'
  ) then
    raise exception 'not allowed';
  end if;

  select a.id into session
  from public.academic_sessions a
  where a.school_id = p_school_id
  order by (current_date between coalesce(a.starts_on, '-infinity') and coalesce(a.ends_on, 'infinity')) desc, a.name desc
  limit 1;
  if session is null then
    raise exception 'no academic session set up yet';
  end if;

  select coalesce(jsonb_agg(distinct jsonb_build_object(
           'class', c->>'class',
           'section', coalesce(c->>'section', ''),
           'in_charge', coalesce((c->>'in_charge')::boolean, false))), '[]'::jsonb)
  into picked
  from jsonb_array_elements(coalesce(p_classes, '[]'::jsonb)) c
  where exists (
    select 1 from public.student_enrolments e
    where e.session_id = session
      and e.class = c->>'class'
      and (coalesce(c->>'section', '') = '' or coalesce(e.section, '') = c->>'section')
  );
  if jsonb_array_length(picked) = 0 then
    raise exception 'pick at least one class';
  end if;

  insert into public.class_allocation_requests (school_id, email, session_id, classes, subjects, note)
  values (p_school_id, me, session, picked, left(trim(p_subjects), 200), left(trim(p_note), 500))
  on conflict (school_id, email) where status = 'pending' do update set
    session_id = excluded.session_id,
    classes = excluded.classes,
    subjects = excluded.subjects,
    note = excluded.note,
    created_at = now();
end
$$;

create or replace function public.approve_class_allocation(request uuid, classes jsonb)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  r public.class_allocation_requests;
  c jsonb;
begin
  select * into r from public.class_allocation_requests where id = request and status = 'pending';
  if r.id is null or not public.is_owner(r.school_id) then
    raise exception 'not allowed';
  end if;

  for c in select * from jsonb_array_elements(coalesce(classes, '[]'::jsonb)) loop
    insert into public.teacher_classes (school_id, email, session_id, class, section)
    values (r.school_id, r.email, r.session_id, c->>'class', nullif(c->>'section', ''))
    on conflict do nothing;

    -- Class teacher, if they asked and the class doesn't have one yet
    if coalesce((c->>'in_charge')::boolean, false) and not exists (
      select 1 from public.teacher_classes t
      where t.school_id = r.school_id and t.session_id = r.session_id
        and t.class = c->>'class' and coalesce(t.section, '') = coalesce(c->>'section', '')
        and t.is_class_teacher
    ) then
      update public.teacher_classes t set is_class_teacher = true
      where t.school_id = r.school_id and t.session_id = r.session_id and t.email = r.email
        and t.class = c->>'class' and coalesce(t.section, '') = coalesce(c->>'section', '');
    end if;
  end loop;

  update public.class_allocation_requests
     set status = 'approved', decided_by = public.current_email(), decided_at = now()
   where id = r.id;
end
$$;

-- ------------------------------------------------------------- my profile ---
-- A staff member updates their own name, designation and phone: on their
-- membership and, when they have one, their staff record (same email).

create function public.update_my_profile(p_school uuid, p_full_name text, p_designation text, p_phone text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  me text := public.current_email();
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

  update public.school_members m set
    full_name = left(trim(p_full_name), 120),
    designation = left(trim(p_designation), 80),
    phone = nullif(left(trim(p_phone), 20), '')
  where m.school_id = p_school and m.email = me;

  update public.employees e set
    name = left(trim(p_full_name), 120),
    designation = left(trim(p_designation), 80),
    phone = nullif(left(trim(p_phone), 20), '')
  where e.school_id = p_school and lower(e.email) = me and e.status <> 'left';
end
$$;

revoke execute on function public.update_my_profile(uuid, text, text, text) from public, anon;
grant execute on function public.update_my_profile(uuid, text, text, text) to authenticated;

-- Their own photo: staff may write <school>/employees/<their record id>
-- (-<time>).jpg, and then set it on their record.
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
    else public.is_admin_folder(object_name)
  end
$$;

create function public.set_my_photo(p_school uuid, p_path text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  me text := public.current_email();
  emp uuid;
begin
  select e.id into emp from public.employees e
  where e.school_id = p_school and lower(e.email) = me and e.status <> 'left'
  limit 1;
  if emp is null
     or p_path !~ ('^' || p_school::text || '/employees/' || emp::text || '(-[0-9]{1,20})?\.jpg$')
     or not exists (select 1 from storage.objects o where o.bucket_id = 'photos' and o.name = p_path) then
    raise exception 'not allowed';
  end if;
  update public.employees set photo_path = p_path where id = emp;
end
$$;

revoke execute on function public.set_my_photo(uuid, text) from public, anon;
grant execute on function public.set_my_photo(uuid, text) to authenticated;

-- Their own staff record (photo and details) for the profile page.
create function public.my_staff_record(p_school uuid)
returns table (id uuid, name text, designation text, phone text, photo_path text)
language sql stable security definer set search_path = '' as $$
  select e.id, e.name, e.designation, e.phone, e.photo_path
  from public.employees e
  where e.school_id = p_school and lower(e.email) = public.current_email() and e.status <> 'left'
  limit 1
$$;

revoke execute on function public.my_staff_record(uuid) from public, anon;
grant execute on function public.my_staff_record(uuid) to authenticated;
