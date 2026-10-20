-- Someone whose app access was removed keeps their Employees profile. When
-- they ask to join again and are approved, that profile used to keep
-- everything from their first time (name, designation, phone, photo), since
-- only a stand-in name was ever replaced. Now joining (a new membership)
-- refreshes the profile from what they just gave; later edits to the
-- membership still only fill gaps, as before.

create or replace function public.member_to_employee() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  emp uuid;
  mobile text := right(regexp_replace(coalesce(new.phone, ''), '\D', '', 'g'), 10);
  placeholder text := split_part(new.email, '@', 1);
  photo text;
  joining boolean := tg_op = 'INSERT';
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
  elsif joining then
    -- Joining (again): what they just gave wins over the old profile.
    update public.employees e set
      email = coalesce(e.email, new.email),
      name = coalesce(nullif(trim(new.full_name), ''), e.name),
      designation = coalesce(nullif(trim(new.designation), ''), e.designation),
      phone = coalesce(nullif(trim(new.phone), ''), e.phone),
      photo_path = coalesce(photo, e.photo_path),
      status = 'active'
    where e.id = emp;
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

revoke execute on function public.member_to_employee() from public, anon, authenticated;
