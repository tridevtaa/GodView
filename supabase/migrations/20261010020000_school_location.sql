-- Let owners and admins set the school's spot on the student map. The schools
-- row is otherwise owner-only and lat/lng had no column grant, so the update
-- from the map was refused.

create function public.set_school_location(school uuid, lat double precision, lng double precision)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_school_admin(school) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  update public.schools s set lat = set_school_location.lat, lng = set_school_location.lng where s.id = school;
end
$$;

revoke execute on function public.set_school_location(uuid, double precision, double precision) from public, anon;
grant execute on function public.set_school_location(uuid, double precision, double precision) to authenticated;
