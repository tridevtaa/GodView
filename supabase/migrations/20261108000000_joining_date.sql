-- The date a teacher joined the school: asked at signup (kept on their
-- request), it becomes their staff record's joining date on approval, and
-- they can change it in My profile.

alter table public.access_requests add column joining_date date;

-- request_access: plus the joining date
drop function public.request_access(text, text, text, text, text, text, text, boolean, text, text, text, text);

create function public.request_access(
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
  p_education_cert_path text,
  p_joining_date date
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
  if p_joining_date is not null and (p_joining_date < date '1950-01-01' or p_joining_date > current_date + 366) then
    raise exception 'joining date looks wrong';
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
     policy_agreed_at, id_proof_path, address_proof_type, address_proof_path, education_cert_path, joining_date)
  values (
    school, me, left(trim(p_full_name), 120), left(trim(p_designation), 80), left(trim(p_phone), 20),
    left(trim(p_subjects), 200), left(trim(p_note), 500), session, p_photo_path,
    case when coalesce(p_policy_agreed, false) then now() else null end,
    p_id_proof_path, p_address_proof_type, p_address_proof_path, p_education_cert_path, p_joining_date
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
    joining_date = excluded.joining_date,
    created_at = now();
end
$$;

revoke execute on function public.request_access(text, text, text, text, text, text, text, boolean, text, text, text, text, date) from public, anon;
grant execute on function public.request_access(text, text, text, text, text, text, text, boolean, text, text, text, text, date) to authenticated;

-- Joining (and joining again) takes the date from their request
create or replace function public.member_to_employee() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  emp uuid;
  mobile text := right(regexp_replace(coalesce(new.phone, ''), '\D', '', 'g'), 10);
  placeholder text := split_part(new.email, '@', 1);
  photo text;
  joined date;
  joining boolean := tg_op = 'INSERT';
  default_designation text := case new.role when 'teacher' then 'Teacher' when 'principal' then 'Principal' else 'Admin' end;
begin
  -- Their photo and joining date from their latest request to join
  select r.photo_path, r.joining_date into photo, joined
  from public.access_requests r
  where r.school_id = new.school_id and r.email = new.email and (r.photo_path is not null or r.joining_date is not null)
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
      coalesce(joined, current_date),
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
      joining_date = coalesce(joined, e.joining_date),
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

-- My profile: plus the joining date (blank keeps what's there)
drop function public.update_my_profile(uuid, text, text, text, text, text, text, text, text, text);

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
  p_subjects text,
  p_joining_date date
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
  if p_joining_date is not null and (p_joining_date < date '1950-01-01' or p_joining_date > current_date + 366) then
    raise exception 'joining date looks wrong';
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
    subjects = nullif(left(trim(p_subjects), 200), ''),
    joining_date = coalesce(p_joining_date, e.joining_date)
  where e.school_id = p_school and lower(e.email) = me and e.status <> 'left';
end
$$;

revoke execute on function public.update_my_profile(uuid, text, text, text, text, text, text, text, text, text, date) from public, anon;
grant execute on function public.update_my_profile(uuid, text, text, text, text, text, text, text, text, text, date) to authenticated;
