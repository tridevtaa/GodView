-- School contact details for parents (their Home shows them): the existing
-- phone, email, website and address, plus a second phone and office hours.
-- Owners and admins edit them (School settings > Contact for parents),
-- through update_school_contact, so admins can't change anything else on
-- the school.

alter table public.schools
  add column phone_2 text check (length(phone_2) <= 20),
  add column office_hours text check (length(office_hours) <= 120);

create function public.update_school_contact(
  p_school uuid,
  p_phone text,
  p_phone_2 text,
  p_email text,
  p_website text,
  p_address text,
  p_city text,
  p_state text,
  p_pincode text,
  p_office_hours text
) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_school_admin(p_school) then
    raise exception 'not allowed';
  end if;
  update public.schools s set
    phone = nullif(left(trim(coalesce(p_phone, '')), 20), ''),
    phone_2 = nullif(left(trim(coalesce(p_phone_2, '')), 20), ''),
    email = nullif(left(trim(coalesce(p_email, '')), 120), ''),
    website = nullif(left(trim(coalesce(p_website, '')), 200), ''),
    address = nullif(left(trim(coalesce(p_address, '')), 300), ''),
    city = nullif(left(trim(coalesce(p_city, '')), 80), ''),
    state = nullif(left(trim(coalesce(p_state, '')), 80), ''),
    pincode = nullif(trim(coalesce(p_pincode, '')), ''),
    office_hours = nullif(left(trim(coalesce(p_office_hours, '')), 120), '')
  where s.id = p_school;
end
$$;

revoke execute on function public.update_school_contact(uuid, text, text, text, text, text, text, text, text, text) from public, anon;
grant execute on function public.update_school_contact(uuid, text, text, text, text, text, text, text, text, text) to authenticated;
