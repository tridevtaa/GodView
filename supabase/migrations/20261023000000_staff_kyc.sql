-- Staff KYC: a school policy new staff must agree to, and three documents
-- (ID proof, address proof, education/employment certificates) collected
-- alongside the existing join-request photo, before the request is sent.
-- Nothing here gates approval — the owner still approves as before, with
-- these now visible on the request to look at first if they want to.

alter table public.schools add column staff_policy text check (length(staff_policy) <= 8000);
grant update (staff_policy) on public.schools to authenticated;

alter table public.access_requests
  add column policy_agreed_at timestamptz,
  add column id_proof_path text,
  add column address_proof_type text check (address_proof_type is null or address_proof_type in ('aadhaar', 'pan', 'dl', 'passport', 'voter_id', 'other')),
  add column address_proof_path text,
  add column education_cert_path text;

-- ------------------------------------------------------------- documents ---

-- A private bucket for the three KYC documents, images or PDFs, kept at
-- requests/<user id>/<id_proof|address_proof|education_cert>.<ext> — same
-- "not a member yet" shape as the join-request photo (join_request_photo.sql).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('staff-documents', 'staff-documents', false, 8388608, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do nothing;

create function public.own_request_document(object_name text) returns boolean
language sql stable set search_path = '' as $$
  select auth.uid() is not null and object_name like 'requests/' || auth.uid()::text || '/%'
$$;

-- Owner/admin of a school this person asked to join.
create function public.can_see_request_document(object_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.access_requests r
    join auth.users u on lower(u.email) = r.email
    where object_name like 'requests/' || u.id::text || '/%'
      and public.is_school_admin(r.school_id)
  )
$$;

revoke execute on function public.own_request_document(text) from public, anon;
revoke execute on function public.can_see_request_document(text) from public, anon;
grant execute on function public.own_request_document(text) to authenticated;
grant execute on function public.can_see_request_document(text) to authenticated;

create policy "people upload their own kyc documents" on storage.objects
  for insert to authenticated with check (bucket_id = 'staff-documents' and public.own_request_document(name));
create policy "people replace their own kyc documents" on storage.objects
  for update to authenticated using (bucket_id = 'staff-documents' and public.own_request_document(name))
  with check (bucket_id = 'staff-documents' and public.own_request_document(name));
create policy "people and school admins see kyc documents" on storage.objects
  for select to authenticated using (
    bucket_id = 'staff-documents' and (public.own_request_document(name) or public.can_see_request_document(name))
  );

-- ------------------------------------------------- lookup_join_code + policy ---

drop function public.lookup_join_code(text);

create function public.lookup_join_code(code text)
returns table (school_name text, logo_path text, staff_policy text, session_name text, classes jsonb)
language sql stable security definer set search_path = '' as $$
  with school as (
    select s.id, s.name, s.logo_path, s.staff_policy
    from public.schools s
    where public.normalise_join_code(s.join_code) = public.normalise_join_code(code)
      and length(public.normalise_join_code(code)) >= 8
  ),
  session as (
    select a.id, a.name
    from public.academic_sessions a, school
    where a.school_id = school.id
    order by (current_date between coalesce(a.starts_on, '-infinity') and coalesce(a.ends_on, 'infinity')) desc, a.name desc
    limit 1
  )
  select
    school.name,
    school.logo_path,
    school.staff_policy,
    session.name,
    coalesce(
      (
        select jsonb_agg(jsonb_build_object('class', c.class, 'section', c.section) order by c.class, c.section)
        from (
          select distinct e.class, coalesce(e.section, '') as section
          from public.student_enrolments e, session
          where e.session_id = session.id and e.class <> ''
        ) c
      ),
      '[]'::jsonb
    )
  from school left join session on true
$$;

revoke execute on function public.lookup_join_code(text) from public, anon;
grant execute on function public.lookup_join_code(text) to authenticated;

-- ------------------------------------------------------------ request_access ---

drop function public.request_access(text, text, text, text, text, text, jsonb, text);

create function public.request_access(
  p_code text,
  p_full_name text,
  p_designation text,
  p_phone text,
  p_subjects text,
  p_note text,
  p_classes jsonb,
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
  picked jsonb;
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

  select coalesce(jsonb_agg(distinct jsonb_build_object('class', c->>'class', 'section', coalesce(c->>'section', ''))), '[]'::jsonb)
  into picked
  from jsonb_array_elements(coalesce(p_classes, '[]'::jsonb)) c
  where exists (
    select 1 from public.student_enrolments e
    where e.session_id = session
      and e.class = c->>'class'
      and (coalesce(c->>'section', '') = '' or coalesce(e.section, '') = c->>'section')
  );

  insert into public.access_requests
    (school_id, email, name, designation, phone, subjects, message, session_id, requested_classes, photo_path,
     policy_agreed_at, id_proof_path, address_proof_type, address_proof_path, education_cert_path)
  values (
    school, me, left(trim(p_full_name), 120), left(trim(p_designation), 80), left(trim(p_phone), 20),
    left(trim(p_subjects), 200), left(trim(p_note), 500), session, picked, p_photo_path,
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
    requested_classes = excluded.requested_classes,
    photo_path = excluded.photo_path,
    policy_agreed_at = excluded.policy_agreed_at,
    id_proof_path = excluded.id_proof_path,
    address_proof_type = excluded.address_proof_type,
    address_proof_path = excluded.address_proof_path,
    education_cert_path = excluded.education_cert_path,
    created_at = now();
end
$$;

revoke execute on function public.request_access(text, text, text, text, text, text, jsonb, text, boolean, text, text, text, text) from public, anon;
grant execute on function public.request_access(text, text, text, text, text, text, jsonb, text, boolean, text, text, text, text) to authenticated;
