-- Staff check-in and check-out from the app, only within the school's
-- radius (100 m by default) of its pinned location. The phone sends where it
-- is; the database measures the distance and uses its own clock, so neither
-- the phone's time nor a typed-in record can make a check-in. Only the
-- distance and the GPS accuracy are kept, never the coordinates.
-- The owner turns it on and sets the radius and the "late after" time.
-- The register follows the Staff permission (View to see, Edit to change
-- the settings).

alter table public.schools
  add column checkin_enabled boolean not null default false,
  add column checkin_radius_m integer not null default 100 check (checkin_radius_m between 50 and 1000),
  add column checkin_late_after time;

create table public.staff_checkins (
  school_id uuid not null references public.schools (id) on delete cascade,
  email text not null check (email = lower(email)),
  day date not null,
  in_at timestamptz not null default now(),
  in_distance_m integer not null,
  in_accuracy_m integer not null,
  out_at timestamptz,
  out_distance_m integer,
  out_accuracy_m integer,
  primary key (school_id, email, day)
);

create index staff_checkins_school_day on public.staff_checkins (school_id, day);

alter table public.staff_checkins enable row level security;

-- Your own days, or everyone's with Staff access across the school. Written
-- only by staff_check() below.
create policy "own or staff viewers read check-ins" on public.staff_checkins
  for select to authenticated
  using (email = public.current_email() or school_id in (select public.schools_wide('staff', 1)));

grant select on public.staff_checkins to authenticated;

-- Metres between two points (haversine).
create function public.metres_between(lat1 double precision, lng1 double precision, lat2 double precision, lng2 double precision)
returns double precision
language sql immutable set search_path = '' as $$
  select 2 * 6371000 * asin(sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2)
    + cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)
  ))
$$;

-- What the check-in card needs: is it on, and today's row.
create function public.checkin_today(p_school uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_mail text := public.current_email();
  s record;
  c record;
begin
  if not exists (select 1 from public.school_members m where m.school_id = p_school and m.email = v_mail) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select sc.checkin_enabled, sc.checkin_radius_m, sc.checkin_late_after, sc.lat is not null and sc.lng is not null as located
    into s from public.schools sc where sc.id = p_school;
  select k.in_at, k.out_at into c from public.staff_checkins k
    where k.school_id = p_school and k.email = v_mail and k.day = (now() at time zone 'Asia/Kolkata')::date;
  return jsonb_build_object(
    'enabled', coalesce(s.checkin_enabled, false) and coalesce(s.located, false),
    'radius', s.checkin_radius_m,
    'late_after', s.checkin_late_after,
    'in_at', c.in_at,
    'out_at', c.out_at
  );
end
$$;

-- Check in ('in') or out ('out'). Errors (message, for the app to explain):
--   off       check-in isn't turned on, or the school has no location
--   rough     the GPS reading is too rough (over 75 m)
--   too-far   outside the radius (detail: metres away)
--   already-in, not-in
-- A rough reading's error is given the benefit of the doubt up to 50 m.
-- Checking out again later in the day moves the check-out time.
create function public.staff_check(p_school uuid, p_action text, p_lat double precision, p_lng double precision, p_accuracy double precision)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_mail text := public.current_email();
  v_day date := (now() at time zone 'Asia/Kolkata')::date;
  s record;
  v_dist double precision;
  r record;
begin
  if p_action not in ('in', 'out') then
    raise exception 'bad action' using errcode = '22023';
  end if;
  if not exists (select 1 from public.school_members m where m.school_id = p_school and m.email = v_mail) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select sc.lat, sc.lng, sc.checkin_enabled, sc.checkin_radius_m into s from public.schools sc where sc.id = p_school;
  if not coalesce(s.checkin_enabled, false) or s.lat is null or s.lng is null then
    raise exception 'off' using errcode = 'P0001';
  end if;
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then
    raise exception 'bad location' using errcode = '22023';
  end if;
  if p_accuracy is null or p_accuracy > 75 then
    raise exception 'rough' using errcode = 'P0001', detail = coalesce(round(p_accuracy)::text, '');
  end if;
  v_dist := public.metres_between(s.lat, s.lng, p_lat, p_lng);
  if v_dist - least(greatest(p_accuracy, 0), 50) > s.checkin_radius_m then
    raise exception 'too-far' using errcode = 'P0001', detail = round(v_dist)::text;
  end if;

  if p_action = 'in' then
    if exists (select 1 from public.staff_checkins k where k.school_id = p_school and k.email = v_mail and k.day = v_day) then
      raise exception 'already-in' using errcode = 'P0001';
    end if;
    insert into public.staff_checkins (school_id, email, day, in_distance_m, in_accuracy_m)
      values (p_school, v_mail, v_day, round(v_dist), round(p_accuracy))
      returning in_at, out_at into r;
  else
    update public.staff_checkins k
      set out_at = now(), out_distance_m = round(v_dist), out_accuracy_m = round(p_accuracy)
      where k.school_id = p_school and k.email = v_mail and k.day = v_day
      returning k.in_at, k.out_at into r;
    if not found then
      raise exception 'not-in' using errcode = 'P0001';
    end if;
  end if;
  return jsonb_build_object('in_at', r.in_at, 'out_at', r.out_at, 'distance', round(v_dist));
end
$$;

-- The register: every staff member who signs in (not owners), with their
-- check-ins between two days. Names and designations from the staff list
-- where the email matches.
create function public.staff_checkin_register(p_school uuid, p_from date, p_to date)
returns table (email text, name text, designation text, role text, day date, in_at timestamptz, out_at timestamptz, in_distance_m integer, out_distance_m integer)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.can_wide(p_school, 'staff', 1) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_to < p_from or p_to - p_from > 62 then
    raise exception 'bad range' using errcode = '22023';
  end if;
  return query
    with people as (
      select m.email, m.role::text as role from public.school_members m
      where m.school_id = p_school and m.role <> 'owner'
      union
      select k.email, null from public.staff_checkins k
      where k.school_id = p_school and k.day between p_from and p_to
        and not exists (select 1 from public.school_members m where m.school_id = p_school and m.email = k.email)
    )
    select p.email, e.name, e.designation, p.role, k.day, k.in_at, k.out_at, k.in_distance_m, k.out_distance_m
    from people p
    left join lateral (
      select e.name, e.designation from public.employees e
      where e.school_id = p_school and lower(e.email) = p.email
      order by (e.status = 'active') desc, e.updated_at desc limit 1
    ) e on true
    left join public.staff_checkins k on k.school_id = p_school and k.email = p.email and k.day between p_from and p_to
    order by coalesce(e.name, p.email), k.day;
end
$$;

-- Owner, or Staff Edit: turn it on, radius, late-after time.
create function public.set_checkin_settings(p_school uuid, p_enabled boolean, p_radius integer, p_late_after time)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.can_wide(p_school, 'staff', 2) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  update public.schools s
    set checkin_enabled = p_enabled, checkin_radius_m = p_radius, checkin_late_after = p_late_after
    where s.id = p_school;
end
$$;

revoke execute on function public.metres_between(double precision, double precision, double precision, double precision) from public, anon;
revoke execute on function public.checkin_today(uuid) from public, anon;
revoke execute on function public.staff_check(uuid, text, double precision, double precision, double precision) from public, anon;
revoke execute on function public.staff_checkin_register(uuid, date, date) from public, anon;
revoke execute on function public.set_checkin_settings(uuid, boolean, integer, time) from public, anon;
grant execute on function public.metres_between(double precision, double precision, double precision, double precision) to authenticated;
grant execute on function public.checkin_today(uuid) to authenticated;
grant execute on function public.staff_check(uuid, text, double precision, double precision, double precision) to authenticated;
grant execute on function public.staff_checkin_register(uuid, date, date) to authenticated;
grant execute on function public.set_checkin_settings(uuid, boolean, integer, time) to authenticated;
