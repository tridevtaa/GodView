-- Each new photo gets its own file name ("<id>-<version>.jpg") instead of
-- replacing "<id>.jpg". Phones keep photos by file name to load quickly, so
-- with one fixed name a changed photo stayed old on every other device
-- (a parent's phone, another teacher's). A new name makes every device
-- fetch the new photo; the old file is then deleted.

-- Students' photos: "<school>/students/<student>.jpg" or
-- "<school>/students/<student>-<digits>.jpg"; the same people as before may
-- write them. Staff photos stay owner/admin only.
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
    else public.is_admin_folder(object_name)
  end
$$;

create or replace function public.set_student_photo(student uuid, path text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  school uuid;
  base text;
begin
  select school_id into school from public.students where id = student;
  if school is null or not public.can_see_student(student) then
    raise exception 'not allowed';
  end if;
  base := school::text || '/students/' || student::text;
  if path is not null and path <> base || '.jpg' and path !~ ('^' || base || '-[0-9]{1,20}\.jpg$') then
    raise exception 'unexpected photo path';
  end if;
  update public.students set photo_path = path where id = student;
end
$$;

-- Whoever may change a student's photo may delete its old files, but never
-- the one in use.
create policy "photo writers remove old photos" on storage.objects
  for delete to authenticated using (
    bucket_id = 'photos'
    and public.can_write_photo(name)
    -- (objects.name: the students and employees tables have a name too)
    and not exists (select 1 from public.students s where s.photo_path = objects.name)
    and not exists (select 1 from public.employees e where e.photo_path = objects.name)
  );
