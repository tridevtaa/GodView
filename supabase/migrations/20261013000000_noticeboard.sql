-- The noticeboard: news, updates and circulars about the school. Any staff
-- member can post; the school's staff read everything, and parents of its
-- students read the notices meant for them. Authors (and owners/admins)
-- can edit, pin and remove.

create table public.notices (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  title text not null check (length(trim(title)) between 1 and 140),
  body text not null default '' check (length(body) <= 4000),
  for_parents boolean not null default true,
  pinned boolean not null default false,
  created_by text not null default public.current_email(),
  author_name text check (length(author_name) <= 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by text
);

create index notices_school on public.notices (school_id, pinned desc, created_at desc);

create function public.notice_author() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  select coalesce(nullif(trim(m.full_name), ''), split_part(m.email, '@', 1)) into new.author_name
  from public.school_members m
  where m.school_id = new.school_id and m.email = new.created_by;
  new.title := trim(new.title);
  return new;
end
$$;

revoke execute on function public.notice_author() from public, anon, authenticated;

create trigger notice_author before insert on public.notices
  for each row execute function public.notice_author();
create trigger notice_touch before update on public.notices
  for each row execute function public.touch();

alter table public.notices enable row level security;
grant select, insert, update, delete on public.notices to authenticated;

create policy "staff and parents read notices" on public.notices
  for select to authenticated using (
    public.is_member(school_id) or (for_parents and public.is_parent_in_school(school_id))
  );
create policy "staff post notices" on public.notices
  for insert to authenticated with check (public.is_member(school_id) and created_by = public.current_email());
create policy "authors or admins change notices" on public.notices
  for update to authenticated
  using (created_by = public.current_email() or public.is_school_admin(school_id))
  with check (public.is_member(school_id));
create policy "authors or admins remove notices" on public.notices
  for delete to authenticated using (created_by = public.current_email() or public.is_school_admin(school_id));

-- Homework's update trigger (touch) records who changed it, but the table
-- had no column for that, so any edit would fail. Nothing edits homework
-- yet; this keeps it from breaking when something does.
alter table public.homework add column if not exists updated_by text;

-- ------------------------------------------------------ parents' counts ---

alter table public.parent_seen drop constraint parent_seen_section_check;
alter table public.parent_seen add constraint parent_seen_section_check
  check (section in ('fees', 'results', 'notes', 'homework', 'requests', 'inbox', 'notices'));

-- Adds the noticeboard: notices for parents in the child's school, newer
-- than the last visit.
create or replace function public.parent_unread()
returns table (student_id uuid, section text, unread bigint, seen_at timestamptz)
language sql stable security invoker set search_path = '' as $$
  with kids as (
    select s.id, s.school_id from public.students s where public.is_parent_of(s.id)
  ),
  sections as (
    select k.id as student_id, k.school_id, x.section, ps.seen_at
    from kids k
    cross join (values ('fees'), ('results'), ('homework'), ('inbox'), ('notices')) as x (section)
    left join public.parent_seen ps
      on ps.student_id = k.id and ps.section = x.section and ps.phone = public.current_phone()
  )
  select
    s.student_id,
    s.section,
    case s.section
      when 'results' then (
        select count(*) from public.exam_results r
        where r.student_id = s.student_id and r.updated_at > coalesce(s.seen_at, '-infinity'))
      when 'fees' then (
        select count(*) from public.fee_invoices i
        where i.student_id = s.student_id and i.created_at > coalesce(s.seen_at, '-infinity'))
        + (
        select count(*) from public.fee_payments p
        where p.student_id = s.student_id and p.created_at > coalesce(s.seen_at, '-infinity'))
      when 'homework' then (
        select count(*) from public.child_homework(s.student_id) h
        where h.created_at > coalesce(s.seen_at, '-infinity'))
      when 'notices' then (
        select count(*) from public.notices n
        where n.school_id = s.school_id and n.for_parents
          and n.created_at > coalesce(s.seen_at, '-infinity'))
      else (
        select count(*) from public.messages m
        where m.student_id = s.student_id and not m.from_parent
          and m.created_at > coalesce(s.seen_at, '-infinity'))
        + (
        select count(*) from public.parent_requests q
        where q.student_id = s.student_id and q.handled_at is not null
          and q.handled_at > coalesce(s.seen_at, '-infinity'))
    end,
    s.seen_at
  from sections s
$$;
