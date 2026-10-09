-- Join codes and richer join requests.
--
-- Each school gets a random join code (e.g. MAV-7K2Q-9XPD) that staff enter
-- when asking to join; the readable slug is no longer accepted. A valid code
-- shows the school's name and its class list (no student data) so a teacher
-- can pick their classes. The owner approves in one step, which creates the
-- membership and the class assignments together.

-- ------------------------------------------------------------- join code ---

-- 8 random characters from an alphabet without look-alikes (0/O, 1/I/L),
-- prefixed by up to 3 letters of the school's slug: MAV-7K2Q-9XPD.
create function public.new_join_code(prefix text) returns text
language plpgsql volatile set search_path = '' as $$
declare
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  body text := '';
  i int;
begin
  for i in 1..8 loop
    body := body || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
  end loop;
  return upper(left(regexp_replace(coalesce(prefix, ''), '[^a-zA-Z]', '', 'g'), 3))
    || case when coalesce(prefix, '') ~ '[a-zA-Z]' then '-' else '' end
    || substr(body, 1, 4) || '-' || substr(body, 5, 4);
end
$$;

alter table public.schools add column join_code text;
update public.schools set join_code = public.new_join_code(slug) where join_code is null;
alter table public.schools alter column join_code set not null;
alter table public.schools add constraint schools_join_code_key unique (join_code);

create function public.schools_default_join_code() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.join_code is null then
    new.join_code := public.new_join_code(new.slug);
  end if;
  return new;
end
$$;

create trigger schools_join_code before insert on public.schools
  for each row execute function public.schools_default_join_code();

-- Normalises what people type: case, spaces and missing dashes don't matter.
create function public.normalise_join_code(code text) returns text
language sql immutable set search_path = '' as $$
  select upper(regexp_replace(coalesce(code, ''), '[^a-zA-Z0-9]', '', 'g'))
$$;

create function public.regenerate_join_code(school uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare
  code text;
begin
  if not public.is_owner(school) then
    raise exception 'only the owner can change the join code';
  end if;
  update public.schools set join_code = public.new_join_code(slug) where id = school returning join_code into code;
  return code;
end
$$;

-- The school a code belongs to, its current session and class list. Nothing
-- (empty result) for an unknown code. Never returns student data.
create function public.lookup_join_code(code text)
returns table (school_name text, session_name text, classes jsonb)
language sql stable security definer set search_path = '' as $$
  with school as (
    select s.id, s.name
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

-- -------------------------------------------------------- member details ---

alter table public.school_members
  add column full_name text check (length(full_name) <= 120),
  add column designation text check (length(designation) <= 80),
  add column phone text check (length(phone) <= 20);

-- --------------------------------------------------------- join requests ---

alter table public.access_requests
  add column designation text check (length(designation) <= 80),
  add column phone text check (length(phone) <= 20),
  add column subjects text check (length(subjects) <= 200),
  add column session_id uuid references public.academic_sessions (id) on delete set null,
  add column requested_classes jsonb not null default '[]'::jsonb
    check (jsonb_typeof(requested_classes) = 'array' and jsonb_array_length(requested_classes) <= 40);

drop function public.request_access(text, text, text);

-- Asks to join the school with this join code. Doesn't reveal anything for an
-- unknown code. `p_classes` is [{ "class": "3", "section": "A" }, …] from
-- lookup_join_code; anything not offered there is dropped.
create function public.request_access(
  p_code text,
  p_full_name text,
  p_designation text,
  p_phone text,
  p_subjects text,
  p_note text,
  p_classes jsonb
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  me text := public.current_email();
  school uuid;
  session uuid;
  offered jsonb;
  picked jsonb;
begin
  if me is null then
    raise exception 'sign in with a verified email first';
  end if;
  if coalesce(trim(p_full_name), '') = '' then
    raise exception 'full name is required';
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

  -- Keep only class/section pairs that exist in that session.
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
    (school_id, email, name, designation, phone, subjects, message, session_id, requested_classes)
  values (
    school, me, left(trim(p_full_name), 120), left(trim(p_designation), 80), left(trim(p_phone), 20),
    left(trim(p_subjects), 200), left(trim(p_note), 500), session, picked
  )
  on conflict (school_id, email) where status = 'pending' do update set
    name = excluded.name,
    designation = excluded.designation,
    phone = excluded.phone,
    subjects = excluded.subjects,
    message = excluded.message,
    session_id = excluded.session_id,
    requested_classes = excluded.requested_classes,
    created_at = now();
end
$$;

-- Owner approves: adds the member with their details and, for teachers, the
-- chosen classes for the request's session, all in one transaction.
create function public.approve_access_request(request uuid, as_role public.member_role, classes jsonb)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  r public.access_requests;
  c jsonb;
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

  if as_role = 'teacher' and r.session_id is not null then
    for c in select * from jsonb_array_elements(coalesce(classes, '[]'::jsonb)) loop
      insert into public.teacher_classes (school_id, email, session_id, class, section)
      values (r.school_id, r.email, r.session_id, c->>'class', nullif(c->>'section', ''))
      on conflict do nothing;
    end loop;
  end if;

  update public.access_requests
     set status = 'approved', decided_by = public.current_email(), decided_at = now()
   where id = r.id;
end
$$;

revoke execute on function public.new_join_code(text) from public, anon, authenticated;
revoke execute on function public.regenerate_join_code(uuid) from public, anon;
revoke execute on function public.lookup_join_code(text) from public, anon;
revoke execute on function public.request_access(text, text, text, text, text, text, jsonb) from public, anon;
revoke execute on function public.approve_access_request(uuid, public.member_role, jsonb) from public, anon;
grant execute on function public.regenerate_join_code(uuid) to authenticated;
grant execute on function public.lookup_join_code(text) to authenticated;
grant execute on function public.request_access(text, text, text, text, text, text, jsonb) to authenticated;
grant execute on function public.approve_access_request(uuid, public.member_role, jsonb) to authenticated;
