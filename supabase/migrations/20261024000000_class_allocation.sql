-- Classes move out of the join-request wizard: new staff no longer pick
-- their classes at signup. Instead, once a teacher is a member with none
-- assigned this session, their dashboard's first screen is to pick them,
-- which the owner approves separately as a class allocation request.

-- ----------------------------------------------------------- request_access ---

drop function public.request_access(text, text, text, text, text, text, jsonb, text, boolean, text, text, text, text);

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

revoke execute on function public.request_access(text, text, text, text, text, text, text, boolean, text, text, text, text) from public, anon;
grant execute on function public.request_access(text, text, text, text, text, text, text, boolean, text, text, text, text) to authenticated;

-- ------------------------------------------------------- approve_access_request ---

drop function public.approve_access_request(uuid, public.member_role, jsonb);

-- Owner approves: just the membership now. Class assignments move to the
-- separate class-allocation request/approve flow below.
create function public.approve_access_request(request uuid, as_role public.member_role)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  r public.access_requests;
begin
  select * into r from public.access_requests where id = request and status = 'pending';
  if r.id is null or not public.is_owner(r.school_id) then
    raise exception 'not allowed';
  end if;
  if as_role = 'owner' then
    raise exception 'owners are not added from requests';
  end if;

  insert into public.school_members (school_id, email, role, full_name, designation, phone, added_by)
  values (r.school_id, r.email, as_role, r.name, r.designation, r.phone, public.current_email())
  on conflict (school_id, email) do update set
    role = excluded.role, full_name = excluded.full_name, designation = excluded.designation, phone = excluded.phone;

  update public.access_requests
     set status = 'approved', decided_by = public.current_email(), decided_at = now()
   where id = r.id;
end
$$;

revoke execute on function public.approve_access_request(uuid, public.member_role) from public, anon;
grant execute on function public.approve_access_request(uuid, public.member_role) to authenticated;

-- ---------------------------------------------------- class allocation requests ---

-- A teacher who's a member but has no classes this session picks them from
-- their dashboard; the owner approves (or rejects) separately from access.
create table public.class_allocation_requests (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  email text not null check (email = lower(email)),
  session_id uuid not null,
  classes jsonb not null default '[]'::jsonb
    check (jsonb_typeof(classes) = 'array' and jsonb_array_length(classes) <= 40),
  subjects text check (length(subjects) <= 200),
  note text check (length(note) <= 500),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  decided_by text,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (session_id, school_id) references public.academic_sessions (id, school_id) on delete cascade,
  foreign key (school_id, email) references public.school_members (school_id, email) on delete cascade
);

create unique index class_allocation_requests_one_pending
  on public.class_allocation_requests (school_id, email) where status = 'pending';

-- Asks for classes for the caller's own membership in that school. Replaces
-- any pending request of theirs; empty or unavailable selections are refused.
create function public.request_class_allocation(p_school_id uuid, p_classes jsonb, p_subjects text, p_note text)
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

  select coalesce(jsonb_agg(distinct jsonb_build_object('class', c->>'class', 'section', coalesce(c->>'section', ''))), '[]'::jsonb)
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

-- Owner approves: adds the teacher_classes rows and marks the request decided.
create function public.approve_class_allocation(request uuid, classes jsonb)
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
  end loop;

  update public.class_allocation_requests
     set status = 'approved', decided_by = public.current_email(), decided_at = now()
   where id = r.id;
end
$$;

revoke execute on function public.request_class_allocation(uuid, jsonb, text, text) from public, anon;
revoke execute on function public.approve_class_allocation(uuid, jsonb) from public, anon;
grant execute on function public.request_class_allocation(uuid, jsonb, text, text) to authenticated;
grant execute on function public.approve_class_allocation(uuid, jsonb) to authenticated;

grant select, update on public.class_allocation_requests to authenticated;

alter table public.class_allocation_requests enable row level security;

create policy "requesters see their own, owner sees school's" on public.class_allocation_requests
  for select to authenticated using (email = public.current_email() or public.is_owner(school_id));
create policy "owner decides class requests" on public.class_allocation_requests
  for update to authenticated using (public.is_owner(school_id)) with check (public.is_owner(school_id));
