-- A Principal role: sees students, attendance, homework, parent requests and
-- employees across the school, and changes nothing. No fees, no imports or
-- exports, no writing (diary, results, photos, attendance, homework,
-- replies). Only read policies are added, so every existing write rule still
-- shuts a principal out.

alter type public.member_role add value if not exists 'principal';

-- (Compared as text: a new enum value can't be used in the transaction
-- that adds it.)
create function public.is_principal(school uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.school_members m
    where m.school_id = school and m.email = public.current_email() and m.role::text = 'principal'
  )
$$;

revoke execute on function public.is_principal(uuid) from public, anon;
grant execute on function public.is_principal(uuid) to authenticated;

create policy "principal reads students" on public.students
  for select to authenticated using (public.is_principal(school_id));
create policy "principal reads enrolments" on public.student_enrolments
  for select to authenticated using (public.is_principal(school_id));
create policy "principal reads student details" on public.student_private
  for select to authenticated using (public.is_principal(school_id));
create policy "principal reads employees" on public.employees
  for select to authenticated using (public.is_principal(school_id));
create policy "principal reads results" on public.exam_results
  for select to authenticated using (public.is_principal(school_id));
create policy "principal reads the diary" on public.student_notes
  for select to authenticated using (public.is_principal(school_id));
create policy "principal reads diary signatures" on public.diary_signatures
  for select to authenticated using (public.is_principal(school_id));
create policy "principal reads requests" on public.parent_requests
  for select to authenticated using (public.is_principal(school_id));
create policy "principal reads class assignments" on public.teacher_classes
  for select to authenticated using (public.is_principal(school_id));
create policy "principal reads the staff list" on public.school_members
  for select to authenticated using (public.is_principal(school_id));
create policy "principal reads homework" on public.homework
  for select to authenticated using (public.is_principal(school_id));
create policy "principal reads homework students" on public.homework_students
  for select to authenticated using (public.is_principal(school_id));
create policy "principal reads attendance" on public.attendance
  for select to authenticated using (public.is_principal(school_id));

-- Fast student list and the attendance overview, for the principal too.
create or replace function public.session_students(session uuid) returns setof jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not (public.is_session_admin(session) or exists (
    select 1 from public.academic_sessions a where a.id = session and public.is_principal(a.school_id)
  )) then
    return;
  end if;
  return query
    select jsonb_build_object(
      'class', e.class,
      'section', e.section,
      'stream', e.stream,
      'roll_no', e.roll_no,
      'status', e.status,
      'student', to_jsonb(s) || jsonb_build_object('private', to_jsonb(p))
    )
    from public.student_enrolments e
    join public.students s on s.id = e.student_id
    left join public.student_private p on p.student_id = s.id
    where e.session_id = session
    order by e.student_id;
end
$$;

create or replace function public.attendance_overview(session uuid, p_day date)
returns table (class text, section text, students bigint, present bigint, absent bigint, late bigint, on_leave bigint, unmarked bigint, marked_by text, class_teacher text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not (public.is_session_admin(session) or exists (
    select 1 from public.academic_sessions a where a.id = session and public.is_principal(a.school_id)
  )) then
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

-- A child's homework, for the principal too.
create or replace function public.child_homework(student uuid)
returns table (id uuid, subject text, body text, due_date date, author_name text, created_at timestamptz, class text, section text, just_some boolean)
language sql stable security definer set search_path = '' as $$
  select h.id, h.subject, h.body, h.due_date, h.author_name, h.created_at, h.class, h.section,
         exists (select 1 from public.homework_students x where x.homework_id = h.id)
  from public.student_enrolments e
  join public.academic_sessions a on a.id = e.session_id
  join public.homework h on h.session_id = e.session_id and h.class = e.class and (h.section is null or h.section = e.section)
  where e.student_id = student
    and (public.is_parent_of(student) or public.can_see_student(student) or public.is_principal(e.school_id))
    and e.session_id = (
      select e2.session_id from public.student_enrolments e2
      join public.academic_sessions a2 on a2.id = e2.session_id
      where e2.student_id = student order by a2.name desc limit 1
    )
    and (
      not exists (select 1 from public.homework_students x where x.homework_id = h.id)
      or exists (select 1 from public.homework_students x where x.homework_id = h.id and x.student_id = student)
    )
  order by h.created_at desc
$$;
