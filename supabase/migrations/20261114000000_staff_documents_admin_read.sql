-- access_requests could only be read by the owner (besides the requester
-- themselves), but the KYC documents' own storage policy already lets any
-- admin see them (can_see_request_document uses is_school_admin) — so an
-- admin could open a document's signed URL but never discover its path
-- through the row. Widens the table read to match the storage read, so a
-- staff documents viewer in their profile works for admins, not just the
-- owner.

drop policy "requesters see their own, owner sees school's" on public.access_requests;
create policy "requesters see their own, admins see school's" on public.access_requests
  for select to authenticated using (email = public.current_email() or public.is_school_admin(school_id));
