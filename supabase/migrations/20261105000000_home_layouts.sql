-- Each person's Home layout (which widgets, their order and sizes), so it
-- follows them across devices. One row per signed-in user and Home
-- (scope: "staff:<school>:<role>" or "parent"). Only the owner of a row can
-- read or change it.

create table public.home_layouts (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  scope text not null check (length(scope) between 1 and 200),
  layout jsonb not null check (pg_column_size(layout) <= 8192),
  updated_at timestamptz not null default now(),
  primary key (user_id, scope)
);

alter table public.home_layouts enable row level security;
grant select, insert, update, delete on public.home_layouts to authenticated;

create policy "own home layout" on public.home_layouts
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
