-- Villages and towns students come from, pinned once on the map. Students
-- are matched to an area by the spellings in `aliases` (from their address
-- or pick-up point), or set to one directly with student_private.area_id.
-- A pinned home (home_lat/home_lng) still wins for that student.

create table public.school_areas (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 80),
  aliases text[] not null default '{}' check (cardinality(aliases) <= 50),
  lat double precision check (lat between -90 and 90),
  lng double precision check (lng between -180 and 180),
  source text check (source in ('osm', 'google', 'manual')),
  created_at timestamptz not null default now(),
  unique (school_id, name),
  unique (id, school_id)
);

alter table public.student_private
  add column area_id uuid,
  add constraint student_private_area_fk foreign key (area_id, school_id)
    references public.school_areas (id, school_id) on delete set null (area_id);

-- Where students live is private: owners and admins only.
grant select, insert, update, delete on public.school_areas to authenticated;
alter table public.school_areas enable row level security;
create policy "admins manage areas" on public.school_areas
  for all to authenticated using (public.is_school_admin(school_id)) with check (public.is_school_admin(school_id));

-- The school's own spot, the anchor for the student map.
alter table public.schools
  add column lat double precision check (lat between -90 and 90),
  add column lng double precision check (lng between -180 and 180);
