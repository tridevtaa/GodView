-- The school's buses, and which bus runs each route.
--
-- buses: registration number, seats, driver and conductor, the dates its
-- papers run out (insurance, fitness/passing, pollution, permit, road
-- tax, fire extinguisher, driver's licence) and its safety kit. Staff can
-- read them; owners and admins manage them.
-- bus_routes gains its bus and its morning and afternoon start times;
-- bus_stops gains a pickup and a drop time.

create table public.buses (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  number text not null check (length(trim(number)) between 1 and 20),
  name text check (length(name) <= 40),
  seats int check (seats between 1 and 120),
  model text check (length(model) <= 60),
  status text not null default 'active' check (status in ('active', 'repair', 'retired')),
  driver_name text check (length(driver_name) <= 80),
  driver_phone text check (driver_phone ~ '^[0-9]{10}$'),
  driver_licence text check (length(driver_licence) <= 30),
  licence_until date,
  conductor_name text check (length(conductor_name) <= 80),
  conductor_phone text check (conductor_phone ~ '^[0-9]{10}$'),
  insurance_until date,
  fitness_until date,
  puc_until date,
  permit_until date,
  tax_until date,
  extinguisher_until date,
  has_gps boolean not null default false,
  has_cctv boolean not null default false,
  has_speed_governor boolean not null default false,
  has_first_aid boolean not null default false,
  notes text check (length(notes) <= 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, school_id)
);

-- "HR 01 AB 1234" and "hr01ab1234" are the same bus
create unique index buses_number on public.buses (school_id, upper(regexp_replace(number, '[^A-Za-z0-9]', '', 'g')));

create function public.buses_touch() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end
$$;
revoke execute on function public.buses_touch() from public, anon, authenticated;
create trigger buses_touch before update on public.buses
  for each row execute function public.buses_touch();

alter table public.bus_routes
  add column bus_id uuid,
  add column morning_at time,
  add column evening_at time,
  add constraint bus_routes_bus_fk foreign key (bus_id, school_id)
    references public.buses (id, school_id) on delete set null (bus_id);

create index bus_routes_bus on public.bus_routes (bus_id);

alter table public.bus_stops
  add column pickup_at time,
  add column drop_at time;

grant select, insert, update, delete on public.buses to authenticated;
alter table public.buses enable row level security;

create policy "staff read buses" on public.buses
  for select to authenticated using (public.is_member(school_id));
create policy "admins manage buses" on public.buses
  for all to authenticated using (public.is_school_admin(school_id)) with check (public.is_school_admin(school_id));
