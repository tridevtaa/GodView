-- Daily attendance, marked by teachers each morning.
--
-- One row per student per day: present, absent, late or leave. Teachers mark
-- students in their own classes (owners and admins mark anyone); parents
-- read their own children's. Owners and admins get a per-class overview of
-- the day, including classes not marked yet.

create table public.attendance (
  student_id uuid not null,
  day date not null,
  school_id uuid not null references public.schools (id) on delete cascade,
  session_id uuid not null,
  status text not null check (status in ('present', 'absent', 'late', 'leave')),
  note text check (length(note) <= 200),
  marked_by text not null default public.current_email(),
  marked_at timestamptz not null default now(),
  primary key (student_id, day),
  foreign key (student_id, school_id) references public.students (id, school_id) on delete cascade,
  foreign key (session_id, school_id) references public.academic_sessions (id, school_id) on delete cascade
);

create index attendance_school_day on public.attendance (school_id, day);

-- Whoever marks (or re-marks) is recorded.
create function public.attendance_marked() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.marked_by := coalesce(public.current_email(), new.marked_by);
  new.marked_at := now();
  return new;
end
$$;

create trigger attendance_marked before insert or update on public.attendance
  for each row execute function public.attendance_marked();

alter table public.attendance enable row level security;
grant select, insert, update, delete on public.attendance to authenticated;

create policy "staff who see the student read attendance" on public.attendance
  for select to authenticated using (public.can_see_student(student_id));
create policy "parents read their children's attendance" on public.attendance
  for select to authenticated using (public.is_parent_of(student_id));
create policy "teachers mark their students" on public.attendance
  for insert to authenticated with check (public.can_see_student(student_id) and day <= current_date + 1);
create policy "teachers correct their students" on public.attendance
  for update to authenticated using (public.can_see_student(student_id))
  with check (public.can_see_student(student_id) and day <= current_date + 1);
create policy "admins remove attendance" on public.attendance
  for delete to authenticated using (public.is_school_admin(school_id));

-- Approved leave requests covering a day (to pre-mark students as on leave).
create function public.leave_on(session uuid, p_day date)
returns table (student_id uuid)
language sql stable security definer set search_path = '' as $$
  select distinct r.student_id
  from public.parent_requests r
  join public.student_enrolments e on e.student_id = r.student_id and e.session_id = session
  where r.kind = 'leave' and r.status = 'approved'
    and p_day between r.leave_from and r.leave_to
    and public.can_see_student(r.student_id)
$$;

-- Owner/admin overview of a day: every class and section in the session,
-- how many marked present, absent, late, on leave, and not marked.
create function public.attendance_overview(session uuid, p_day date)
returns table (class text, section text, students bigint, present bigint, absent bigint, late bigint, on_leave bigint, unmarked bigint, marked_by text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_session_admin(session) then
    return;
  end if;
  return query
    select e.class, coalesce(e.section, ''),
      count(*),
      count(*) filter (where a.status = 'present'),
      count(*) filter (where a.status = 'absent'),
      count(*) filter (where a.status = 'late'),
      count(*) filter (where a.status = 'leave'),
      count(*) filter (where a.status is null),
      max(a.marked_by)
    from public.student_enrolments e
    left join public.attendance a on a.student_id = e.student_id and a.day = p_day
    where e.session_id = session and e.status <> 'left'
    group by e.class, coalesce(e.section, '');
end
$$;

-- A student's month: days present/absent/late/leave (for profiles and parents).
create function public.attendance_month(student uuid, month date)
returns table (day date, status text)
language sql stable security invoker set search_path = '' as $$
  select a.day, a.status
  from public.attendance a
  where a.student_id = student
    and a.day >= date_trunc('month', month)::date
    and a.day < (date_trunc('month', month) + interval '1 month')::date
  order by a.day
$$;

revoke execute on function public.attendance_marked() from public, anon, authenticated;
revoke execute on function public.leave_on(uuid, date) from public, anon;
revoke execute on function public.attendance_overview(uuid, date) from public, anon;
revoke execute on function public.attendance_month(uuid, date) from public, anon;
grant execute on function public.leave_on(uuid, date) to authenticated;
grant execute on function public.attendance_overview(uuid, date) to authenticated;
grant execute on function public.attendance_month(uuid, date) to authenticated;
