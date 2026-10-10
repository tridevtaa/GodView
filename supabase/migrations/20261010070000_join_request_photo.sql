-- Staff asking to join must add a photo of themselves. Before approval they
-- aren't members, so the photo lives at photos/requests/<their user id>.jpg:
-- only they can write it; the owner and admins of a school they asked to
-- join can see it. On approval it becomes their Employees photo.

alter table public.access_requests add column photo_path text;

create function public.own_request_photo(object_name text) returns boolean
language sql stable set search_path = '' as $$
  select auth.uid() is not null and object_name = 'requests/' || auth.uid()::text || '.jpg'
$$;

-- Owner/admin of a school this person asked to join.
create function public.can_see_request_photo(object_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.access_requests r
    join auth.users u on lower(u.email) = r.email
    where object_name = 'requests/' || u.id::text || '.jpg'
      and public.is_school_admin(r.school_id)
  )
$$;

revoke execute on function public.own_request_photo(text) from public, anon;
revoke execute on function public.can_see_request_photo(text) from public, anon;
grant execute on function public.own_request_photo(text) to authenticated;
grant execute on function public.can_see_request_photo(text) to authenticated;

create policy "people upload their own join photo" on storage.objects
  for insert to authenticated with check (bucket_id = 'photos' and public.own_request_photo(name));
create policy "people replace their own join photo" on storage.objects
  for update to authenticated using (bucket_id = 'photos' and public.own_request_photo(name))
  with check (bucket_id = 'photos' and public.own_request_photo(name));
create policy "people and school admins see join photos" on storage.objects
  for select to authenticated using (
    bucket_id = 'photos' and (public.own_request_photo(name) or public.can_see_request_photo(name))
  );

-- request_access now needs the photo.
drop function public.request_access(text, text, text, text, text, text, jsonb);

create function public.request_access(
  p_code text,
  p_full_name text,
  p_designation text,
  p_phone text,
  p_subjects text,
  p_note text,
  p_classes jsonb,
  p_photo_path text
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  me text := public.current_email();
  school uuid;
  session uuid;
  picked jsonb;
begin
  if me is null then
    raise exception 'sign in with a verified email first';
  end if;
  if coalesce(trim(p_full_name), '') = '' then
    raise exception 'full name is required';
  end if;
  if p_photo_path is distinct from 'requests/' || auth.uid()::text || '.jpg'
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
    (school_id, email, name, designation, phone, subjects, message, session_id, requested_classes, photo_path)
  values (
    school, me, left(trim(p_full_name), 120), left(trim(p_designation), 80), left(trim(p_phone), 20),
    left(trim(p_subjects), 200), left(trim(p_note), 500), session, picked, p_photo_path
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
    created_at = now();
end
$$;

revoke execute on function public.request_access(text, text, text, text, text, text, jsonb, text) from public, anon;
grant execute on function public.request_access(text, text, text, text, text, text, jsonb, text) to authenticated;

-- Teachers in Employees get the photo from their join request.
create or replace function public.member_to_employee() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  emp uuid;
  mobile text := right(regexp_replace(coalesce(new.phone, ''), '\D', '', 'g'), 10);
  placeholder text := split_part(new.email, '@', 1);
  photo text;
begin
  if new.role <> 'teacher' then
    return new;
  end if;

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
      coalesce(nullif(trim(new.designation), ''), 'Teacher'),
      nullif(trim(new.phone), ''),
      new.email,
      current_date,
      'active',
      photo
    );
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
