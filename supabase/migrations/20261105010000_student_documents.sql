-- Student documents: Aadhaar card, birth certificate, and (for a student
-- transferring in from another school) the transfer/leaving certificate
-- (SLC), attached from the add-student form. Kept at
-- students/<school id>/students/<student id>/<kind>.<ext> in their own
-- private bucket since they're often PDFs, not photos.
--
-- Write access matches who can add/edit a student (owners/admins); read
-- access also includes the student's class teachers, same as the rest of
-- the student's row (can_see_student).

alter table public.students
  add column aadhaar_doc_path text,
  add column birth_cert_path text,
  add column transfer_cert_path text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('student-documents', 'student-documents', false, 8388608, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do nothing;

create function public.can_see_student_document(object_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.students s
    where object_name ~ '^[0-9a-f-]{36}/students/[0-9a-f-]{36}/(aadhaar|birth_certificate|transfer_certificate)\.[a-z0-9]+$'
      and s.school_id::text = split_part(object_name, '/', 1)
      and s.id::text = split_part(object_name, '/', 3)
      and public.can_see_student(s.id)
  )
$$;

revoke execute on function public.can_see_student_document(text) from public, anon;
grant execute on function public.can_see_student_document(text) to authenticated;

create policy "admins upload student documents" on storage.objects
  for insert to authenticated with check (bucket_id = 'student-documents' and public.is_admin_folder(name));
create policy "admins replace student documents" on storage.objects
  for update to authenticated using (bucket_id = 'student-documents' and public.is_admin_folder(name))
  with check (bucket_id = 'student-documents' and public.is_admin_folder(name));
create policy "admins delete student documents" on storage.objects
  for delete to authenticated using (bucket_id = 'student-documents' and public.is_admin_folder(name));
create policy "admins and class teachers see student documents" on storage.objects
  for select to authenticated using (
    bucket_id = 'student-documents' and (public.is_admin_folder(name) or public.can_see_student_document(name))
  );
