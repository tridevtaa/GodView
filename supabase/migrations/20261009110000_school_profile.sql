-- School profile: details and logo, editable by the owner only.
--
-- Logos live in a public bucket ("school-logos") because they're shown before
-- anyone has joined (on the join screen); nothing sensitive goes there.

alter table public.schools
  add column short_name text check (length(short_name) <= 40),
  add column logo_path text,
  add column board text check (length(board) <= 60),
  add column affiliation_no text check (length(affiliation_no) <= 40),
  add column udise_code text check (udise_code ~ '^\d{11}$'),
  add column principal_name text check (length(principal_name) <= 120),
  add column address text check (length(address) <= 300),
  add column city text check (length(city) <= 80),
  add column state text check (length(state) <= 80),
  add column pincode text check (pincode ~ '^\d{6}$'),
  add column phone text check (length(phone) <= 20),
  add column email text check (length(email) <= 120),
  add column website text check (length(website) <= 200),
  add column updated_at timestamptz not null default now();

alter table public.schools add constraint schools_name_length check (length(trim(name)) between 2 and 120);

-- Only these columns can be changed from the app; slug and join_code can't.
grant update (
  name, short_name, logo_path, board, affiliation_no, udise_code, principal_name,
  address, city, state, pincode, phone, email, website
) on public.schools to authenticated;

create policy "owner edits school profile" on public.schools
  for update to authenticated using (public.is_owner(id)) with check (public.is_owner(id));

create function public.schools_touch() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end
$$;

create trigger schools_touch before update on public.schools
  for each row execute function public.schools_touch();

-- ------------------------------------------------------------------ logo ---

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('school-logos', 'school-logos', true, 1048576, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do nothing;

-- Owner of the school named by the first folder of the path (text compare).
create function public.is_owner_folder(object_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.school_members m
    where m.school_id::text = split_part(object_name, '/', 1)
      and m.email = public.current_email()
      and m.role = 'owner'
  )
$$;

revoke execute on function public.is_owner_folder(text) from public, anon;
grant execute on function public.is_owner_folder(text) to authenticated;

-- Uploads read the object back (and upserts check it exists), so signed-in
-- users need select on this public bucket too.
create policy "anyone signed in reads school logos" on storage.objects
  for select to authenticated using (bucket_id = 'school-logos');
create policy "owner uploads school logo" on storage.objects
  for insert to authenticated with check (bucket_id = 'school-logos' and public.is_owner_folder(name));
create policy "owner replaces school logo" on storage.objects
  for update to authenticated using (bucket_id = 'school-logos' and public.is_owner_folder(name))
  with check (bucket_id = 'school-logos' and public.is_owner_folder(name));
create policy "owner removes school logo" on storage.objects
  for delete to authenticated using (bucket_id = 'school-logos' and public.is_owner_folder(name));

-- --------------------------------------------- join screen shows the logo ---

drop function public.lookup_join_code(text);

create function public.lookup_join_code(code text)
returns table (school_name text, logo_path text, session_name text, classes jsonb)
language sql stable security definer set search_path = '' as $$
  with school as (
    select s.id, s.name, s.logo_path
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
