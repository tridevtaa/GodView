-- Class teachers (in-charge). The owner marks one of a class's assigned
-- teachers as its class teacher (one per class and section, per session).
-- Only the class teacher marks that class's attendance; owners and admins
-- can still mark or correct any class as a fallback. Other teachers of the
-- class can see the register but not change it.

alter table public.teacher_classes add column is_class_teacher boolean not null default false;

create unique index teacher_classes_one_class_teacher
  on public.teacher_classes (school_id, session_id, class, coalesce(section, ''))
  where is_class_teacher;

-- May the caller mark this student's attendance?
create function public.can_mark_attendance(student uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.students s where s.id = student and public.is_school_admin(s.school_id)
  ) or exists (
    select 1
    from public.student_enrolments e
    join public.teacher_classes t
      on t.school_id = e.school_id
     and t.session_id = e.session_id
     and t.class = e.class
     and (t.section is null or t.section = e.section)
    where e.student_id = student
      and t.email = public.current_email()
      and t.is_class_teacher
  )
$$;

revoke execute on function public.can_mark_attendance(uuid) from public, anon;
grant execute on function public.can_mark_attendance(uuid) to authenticated;

drop policy "teachers mark their students" on public.attendance;
drop policy "teachers correct their students" on public.attendance;

create policy "class teachers mark their class" on public.attendance
  for insert to authenticated with check (public.can_mark_attendance(student_id) and day <= current_date + 1);
create policy "class teachers correct their class" on public.attendance
  for update to authenticated using (public.can_mark_attendance(student_id))
  with check (public.can_mark_attendance(student_id) and day <= current_date + 1);

-- The day overview names each class's class teacher.
drop function public.attendance_overview(uuid, date);

create function public.attendance_overview(session uuid, p_day date)
returns table (class text, section text, students bigint, present bigint, absent bigint, late bigint, on_leave bigint, unmarked bigint, marked_by text, class_teacher text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_session_admin(session) then
    return;
  end if;
  return query
    with counts as (
      select e.class, coalesce(e.section, '') as section,
        count(*) as students,
        count(*) filter (where a.status = 'present') as present,
        count(*) filter (where a.status = 'absent') as absent,
        count(*) filter (where a.status = 'late') as late,
        count(*) filter (where a.status = 'leave') as on_leave,
        count(*) filter (where a.status is null) as unmarked,
        max(a.marked_by) as marked_by
      from public.student_enrolments e
      left join public.attendance a on a.student_id = e.student_id and a.day = p_day
      where e.session_id = session and e.status <> 'left'
      group by e.class, coalesce(e.section, '')
    )
    select c.class, c.section, c.students, c.present, c.absent, c.late, c.on_leave, c.unmarked, c.marked_by,
      (
        select coalesce(nullif(trim(m.full_name), ''), split_part(m.email, '@', 1))
        from public.teacher_classes t
        join public.school_members m on m.school_id = t.school_id and m.email = t.email
        where t.session_id = session and t.is_class_teacher and t.class = c.class
          and (t.section is null or t.section = c.section)
        order by t.section nulls last
        limit 1
      )
    from counts c;
end
$$;

revoke execute on function public.attendance_overview(uuid, date) from public, anon;
grant execute on function public.attendance_overview(uuid, date) to authenticated;
