-- Teachers who join (approved join request, added on the Owner page, or
-- switched to the teacher role) appear in Employees automatically. If they
-- are already there (same email, or same mobile for staff imported from the
-- old ERP), that record is linked and filled in instead of duplicated.

create function public.member_to_employee() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  emp uuid;
  mobile text := right(regexp_replace(coalesce(new.phone, ''), '\D', '', 'g'), 10);
  placeholder text := split_part(new.email, '@', 1);
begin
  if new.role <> 'teacher' then
    return new;
  end if;

  select e.id into emp
  from public.employees e
  where e.school_id = new.school_id
    and (lower(e.email) = new.email
      or (length(mobile) = 10 and right(regexp_replace(coalesce(e.phone, ''), '\D', '', 'g'), 10) = mobile))
  order by (lower(e.email) = new.email) desc nulls last
  limit 1;

  if emp is null then
    insert into public.employees (school_id, name, designation, phone, email, joining_date, status)
    values (
      new.school_id,
      coalesce(nullif(trim(new.full_name), ''), placeholder),
      coalesce(nullif(trim(new.designation), ''), 'Teacher'),
      nullif(trim(new.phone), ''),
      new.email,
      current_date,
      'active'
    );
  else
    update public.employees e set
      email = coalesce(e.email, new.email),
      phone = coalesce(e.phone, nullif(trim(new.phone), '')),
      designation = coalesce(e.designation, nullif(trim(new.designation), '')),
      -- Replace a stand-in name (the email's first part) once a real one arrives.
      name = case when e.name = placeholder and nullif(trim(new.full_name), '') is not null then trim(new.full_name) else e.name end,
      status = case when e.status = 'left' then e.status else 'active' end
    where e.id = emp;
  end if;
  return new;
end
$$;

revoke execute on function public.member_to_employee() from public, anon, authenticated;

create trigger school_members_to_employees
  after insert or update of role, full_name, designation, phone on public.school_members
  for each row execute function public.member_to_employee();

-- Teachers who joined before this: add them now.
update public.school_members set role = role where role = 'teacher';
