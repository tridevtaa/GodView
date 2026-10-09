-- Bus routes with stops on the map, and each student's home and bus stop.
--
-- bus_routes: the school's routes (e.g. "Route 3 · Hema Majra").
-- bus_stops: stops on a route, pinned on the map (Google place + lat/lng).
-- student_private gains the home pin and transport choice; like phone
-- numbers, these are visible to owners and admins only.

create table public.bus_routes (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 60),
  sort int not null default 0,
  created_at timestamptz not null default now(),
  unique (school_id, name),
  unique (id, school_id)
);

create table public.bus_stops (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null,
  route_id uuid not null,
  name text not null check (length(trim(name)) between 1 and 80),
  address text,
  place_id text,
  lat double precision check (lat between -90 and 90),
  lng double precision check (lng between -180 and 180),
  sort int not null default 0,
  created_at timestamptz not null default now(),
  unique (id, school_id),
  foreign key (route_id, school_id) references public.bus_routes (id, school_id) on delete cascade
);

create index bus_stops_route on public.bus_stops (route_id, sort);

alter table public.student_private
  add column home_lat double precision check (home_lat between -90 and 90),
  add column home_lng double precision check (home_lng between -180 and 180),
  add column home_place_id text,
  add column uses_bus boolean not null default false,
  add column bus_stop_id uuid,
  add constraint student_private_stop_fk foreign key (bus_stop_id, school_id)
    references public.bus_stops (id, school_id) on delete set null (bus_stop_id);

-- Members and parents of the school can see routes and stops (parents will
-- follow their child's bus later); owners and admins manage them.
grant select, insert, update, delete on public.bus_routes to authenticated;
grant select, insert, update, delete on public.bus_stops to authenticated;
alter table public.bus_routes enable row level security;
alter table public.bus_stops enable row level security;

create policy "school reads bus routes" on public.bus_routes
  for select to authenticated using (public.is_member(school_id) or public.is_parent_in_school(school_id));
create policy "admins manage bus routes" on public.bus_routes
  for all to authenticated using (public.is_school_admin(school_id)) with check (public.is_school_admin(school_id));

create policy "school reads bus stops" on public.bus_stops
  for select to authenticated using (public.is_member(school_id) or public.is_parent_in_school(school_id));
create policy "admins manage bus stops" on public.bus_stops
  for all to authenticated using (public.is_school_admin(school_id)) with check (public.is_school_admin(school_id));
