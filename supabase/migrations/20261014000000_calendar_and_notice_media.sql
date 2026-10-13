-- The school calendar (holidays, exams, events, meetings), and a date and
-- an image on notices.
--
-- Calendar: owners and admins add and change entries; the school's staff
-- read all of them, parents of its students the ones meant for them.
-- Notices with a date show on the calendar too (in the app).

create table public.calendar_events (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  title text not null check (length(trim(title)) between 1 and 120),
  kind text not null default 'event' check (kind in ('holiday', 'exam', 'event', 'meeting', 'other')),
  starts_on date not null,
  ends_on date check (ends_on is null or ends_on >= starts_on),
  note text not null default '' check (length(note) <= 1000),
  for_parents boolean not null default true,
  created_by text not null default public.current_email(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by text
);

create index calendar_events_school on public.calendar_events (school_id, starts_on);

create trigger calendar_events_touch before update on public.calendar_events
  for each row execute function public.touch();

alter table public.calendar_events enable row level security;
grant select, insert, update, delete on public.calendar_events to authenticated;

create policy "staff and parents read the calendar" on public.calendar_events
  for select to authenticated using (
    public.is_member(school_id) or (for_parents and public.is_parent_in_school(school_id))
  );
create policy "admins add to the calendar" on public.calendar_events
  for insert to authenticated with check (public.is_school_admin(school_id) and created_by = public.current_email());
create policy "admins change the calendar" on public.calendar_events
  for update to authenticated using (public.is_school_admin(school_id)) with check (public.is_school_admin(school_id));
create policy "admins remove from the calendar" on public.calendar_events
  for delete to authenticated using (public.is_school_admin(school_id));

-- ------------------------------------------------------ notice date, image ---

alter table public.notices
  add column event_on date,
  add column image_path text check (image_path is null or length(image_path) <= 300);

-- An image must live in the school's own folder.
alter table public.notices add constraint notices_image_in_school
  check (image_path is null or split_part(image_path, '/', 1) = school_id::text);

-- Images: a private bucket, one folder per school ("<school id>/<file>").
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('notice-images', 'notice-images', false, 3145728, array['image/webp', 'image/jpeg', 'image/png'])
on conflict (id) do nothing;

-- Who may see an image: whoever may see the notice it's on (staff of the
-- school; parents only for notices meant for them). An image not on any
-- notice yet (just uploaded) is seen by the school's staff only.
create function public.can_see_notice_image(object_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.notices n
    where n.image_path = object_name
      and (public.is_member(n.school_id) or (n.for_parents and public.is_parent_in_school(n.school_id)))
  ) or exists (
    select 1 from public.school_members m
    where m.school_id::text = split_part(object_name, '/', 1) and m.email = public.current_email()
  )
$$;

-- Removing one: the notice's author or an owner/admin; an image not on any
-- notice (a post that failed) by any staff member of the school.
create function public.can_remove_notice_image(object_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select case
    when exists (select 1 from public.notices n where n.image_path = object_name) then exists (
      select 1 from public.notices n
      where n.image_path = object_name
        and (n.created_by = public.current_email() or public.is_school_admin(n.school_id))
    )
    else exists (
      select 1 from public.school_members m
      where m.school_id::text = split_part(object_name, '/', 1) and m.email = public.current_email()
    )
  end
$$;

revoke execute on function public.can_see_notice_image(text) from public, anon;
revoke execute on function public.can_remove_notice_image(text) from public, anon;
grant execute on function public.can_see_notice_image(text) to authenticated;
grant execute on function public.can_remove_notice_image(text) to authenticated;

create policy "staff and parents see notice images" on storage.objects
  for select to authenticated using (bucket_id = 'notice-images' and public.can_see_notice_image(name));
create policy "staff upload notice images" on storage.objects
  for insert to authenticated with check (bucket_id = 'notice-images' and public.is_member_folder(name));
create policy "authors or admins remove notice images" on storage.objects
  for delete to authenticated using (bucket_id = 'notice-images' and public.can_remove_notice_image(name));

-- Pictures are kept for 30 days after the notice is posted, to keep
-- storage small; the notice itself stays. When staff open the noticeboard,
-- the app takes the expired ones off their notices (here) and deletes the
-- files (any staff member of the school may delete a picture no notice
-- uses any more).
create function public.take_expired_notice_images(school uuid) returns setof text
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_member(school) then
    return;
  end if;
  return query
    with expired as (
      select n.id, n.image_path from public.notices n
      where n.school_id = school and n.image_path is not null
        and n.created_at < now() - interval '30 days'
      for update
    ),
    cleared as (
      update public.notices n set image_path = null
      from expired e where n.id = e.id
      returning e.image_path
    )
    select c.image_path from cleared c;
end
$$;

revoke execute on function public.take_expired_notice_images(uuid) from public, anon;
grant execute on function public.take_expired_notice_images(uuid) to authenticated;
