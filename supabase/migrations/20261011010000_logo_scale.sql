-- How big the school's logo shows beside the Godview mark in the header
-- (1 = the default size). Owners set it in School settings, so logos with
-- lots of empty space or very wide ones don't look uneven.
alter table public.schools
  add column logo_scale numeric(3, 2) not null default 1
    check (logo_scale between 0.5 and 2);

grant update (logo_scale) on public.schools to authenticated;
