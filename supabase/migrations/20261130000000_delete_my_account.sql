-- Delete my account, from My profile (staff and parents), as Google Play
-- asks: the person's sign-in and the personal details they keep in Godview
-- go; the school's own records (attendance, results, fees, the payment log,
-- messages, their name on the staff or parent record) stay, as the privacy
-- policy says.
--
-- The delete-account edge function verifies who is asking, calls
-- delete_account_data() with the service role, removes the files it lists
-- through the Storage API (storage.objects can't be deleted with SQL) and
-- then deletes the auth user, which takes their push devices and home
-- layouts with it (on delete cascade).
--
-- A school's only owner can't delete their account: the school would be
-- left with nobody to run it. They add another owner first, or write to us
-- to close the school.

-- Schools where the signed-in person is the only owner. Empty: nothing in
-- the way.
create function public.account_deletion_blockers() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name) order by s.name), '[]'::jsonb)
  from public.school_members m
  join public.schools s on s.id = m.school_id
  where m.email = public.current_email()
    and m.role = 'owner'
    and not exists (
      select 1 from public.school_members o
      where o.school_id = m.school_id and o.role = 'owner' and o.email <> m.email
    )
$$;

revoke execute on function public.account_deletion_blockers() from public, anon;
grant execute on function public.account_deletion_blockers() to authenticated;

-- Removes one person's data. Returns the files to remove from Storage.
create function public.delete_account_data(p_user uuid)
returns table (bucket text, path text)
language plpgsql security definer set search_path = '' as $$
declare
  v_mail text;
  v_phone text;
begin
  select lower(u.email), public.normalise_phone(u.phone) into v_mail, v_phone
  from auth.users u where u.id = p_user;
  if not found then
    raise exception 'no such user' using errcode = 'P0002';
  end if;

  if v_mail is not null and exists (
    select 1 from public.school_members m
    where m.email = v_mail and m.role = 'owner'
      and not exists (select 1 from public.school_members o where o.school_id = m.school_id and o.role = 'owner' and o.email <> v_mail)
  ) then
    raise exception 'only owner' using errcode = 'P0001', hint = 'sole-owner';
  end if;

  -- Files first, while the rows still point at them (return query adds
  -- to the result and carries on): join request photo and KYC documents,
  -- and their own photo on staff and parent records.
  return query
    select o.bucket_id::text, o.name::text from storage.objects o
    where (o.bucket_id = 'staff-documents' and o.name like 'requests/' || p_user::text || '/%')
       or (o.bucket_id = 'photos' and o.name = 'requests/' || p_user::text || '.jpg')
    union
    select 'photos', e.photo_path from public.employees e
    where v_mail is not null and lower(e.email) = v_mail and e.photo_path is not null
    union
    select 'photos', g.photo_path from public.guardians g
    where v_phone is not null and g.phone = v_phone and g.photo_path is not null;

  if v_mail is not null then
    -- Staff: their access, classes and join requests (with the KYC
    -- documents on them) go; the staff record keeps only what the school
    -- needs (name, designation, joining date).
    update public.employees e set
      photo_path = null, id_type = null, id_last4 = null, emergency_name = null, emergency_phone = null
    where lower(e.email) = v_mail;
    delete from public.teacher_classes t where t.email = v_mail;
    delete from public.access_requests r where r.email = v_mail;
    delete from public.message_reads r where r.reader = v_mail;
    delete from public.school_members m where m.email = v_mail; -- class allocation requests go with it
  end if;

  if v_phone is not null then
    -- Parents: the details they added themselves go; the number and name
    -- stay on the child's record, which belongs to the school.
    update public.guardians g set
      email = null, id_type = null, id_last4 = null, address = null, photo_path = null, updated_at = now()
    where g.phone = v_phone;
    delete from public.parent_seen s where s.phone = v_phone;
    delete from public.parent_login_attempts a where a.phone = v_phone;
  end if;

  delete from public.assistant_usage a where a.user_id = p_user;
end
$$;

revoke execute on function public.delete_account_data(uuid) from public, anon, authenticated;
grant execute on function public.delete_account_data(uuid) to service_role;
