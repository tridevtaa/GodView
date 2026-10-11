-- Red dots for parents: when each parent last opened each section (fees,
-- results, notes, requests) for each child, and how many things are newer.
-- Kept per parent phone, so the dots follow them across devices.

create table public.parent_seen (
  phone text not null,
  student_id uuid not null references public.students (id) on delete cascade,
  section text not null check (section in ('fees', 'results', 'notes', 'requests')),
  seen_at timestamptz not null default now(),
  primary key (phone, student_id, section)
);

alter table public.parent_seen enable row level security;
grant select on public.parent_seen to authenticated;
create policy "parents read what they've seen" on public.parent_seen
  for select to authenticated using (phone = public.current_phone());

-- Marks a section as seen now. Only for the parent's own children.
create function public.mark_parent_seen(student uuid, p_section text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_parent_of(student) then
    raise exception 'not allowed';
  end if;
  insert into public.parent_seen (phone, student_id, section, seen_at)
  values (public.current_phone(), student, p_section, now())
  on conflict (phone, student_id, section) do update set seen_at = now();
end
$$;

-- For each child and section: things newer than the last visit, and when
-- that was (null = never opened). Runs as the parent, so RLS limits it to
-- their own children and to notes shared with them.
create function public.parent_unread()
returns table (student_id uuid, section text, unread bigint, seen_at timestamptz)
language sql stable security invoker set search_path = '' as $$
  with kids as (
    select s.id from public.students s where public.is_parent_of(s.id)
  ),
  sections as (
    select k.id as student_id, x.section, ps.seen_at
    from kids k
    cross join (values ('fees'), ('results'), ('notes'), ('requests')) as x (section)
    left join public.parent_seen ps
      on ps.student_id = k.id and ps.section = x.section and ps.phone = public.current_phone()
  )
  select
    s.student_id,
    s.section,
    case s.section
      when 'notes' then (
        select count(*) from public.student_notes n
        where n.student_id = s.student_id and n.shared_with_parents
          and n.updated_at > coalesce(s.seen_at, '-infinity'))
      when 'results' then (
        select count(*) from public.exam_results r
        where r.student_id = s.student_id and r.updated_at > coalesce(s.seen_at, '-infinity'))
      when 'fees' then (
        select count(*) from public.fee_invoices i
        where i.student_id = s.student_id and i.created_at > coalesce(s.seen_at, '-infinity'))
        + (
        select count(*) from public.fee_payments p
        where p.student_id = s.student_id and p.created_at > coalesce(s.seen_at, '-infinity'))
      else (
        select count(*) from public.parent_requests q
        where q.student_id = s.student_id and q.handled_at is not null
          and q.handled_at > coalesce(s.seen_at, '-infinity'))
    end,
    s.seen_at
  from sections s
$$;

revoke execute on function public.mark_parent_seen(uuid, text) from public, anon;
revoke execute on function public.parent_unread() from public, anon;
grant execute on function public.mark_parent_seen(uuid, text) to authenticated;
grant execute on function public.parent_unread() to authenticated;
