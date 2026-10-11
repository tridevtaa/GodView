-- Parents can see their own children's photos (the photos bucket is
-- otherwise staff only). Only the exact object on the student's record.

create function public.is_parent_photo(object_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.students s
    where s.photo_path = object_name and public.is_parent_of(s.id)
  )
$$;

revoke execute on function public.is_parent_photo(text) from public, anon;
grant execute on function public.is_parent_photo(text) to authenticated;

create policy "parents read their children's photos" on storage.objects
  for select to authenticated using (bucket_id = 'photos' and public.is_parent_photo(name));
