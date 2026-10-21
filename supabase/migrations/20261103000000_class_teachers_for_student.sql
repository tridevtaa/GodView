-- A student's teachers, for the student page: everyone assigned to the
-- student's class (and section) this session, the class teacher first.
-- Teachers can only read their own assignments, so this runs as the
-- definer, for anyone who may see the student. Names and photos come from
-- the staff records (same email).

create function public.class_teachers_for_student(student uuid, session uuid)
returns table (id uuid, name text, designation text, photo_path text, is_class_teacher boolean)
language sql stable security definer set search_path = '' as $$
  select
    e.id,
    coalesce(e.name, split_part(t.email, '@', 1)) as name,
    e.designation,
    e.photo_path,
    bool_or(t.is_class_teacher) as is_class_teacher
  from public.student_enrolments en
  join public.teacher_classes t
    on t.school_id = en.school_id
   and t.session_id = en.session_id
   and t.class = en.class
   and (t.section is null or t.section = en.section)
  left join lateral (
    select x.id, x.name, x.designation, x.photo_path
    from public.employees x
    where x.school_id = t.school_id and lower(x.email) = t.email and x.status <> 'left'
    order by (x.status = 'active') desc
    limit 1
  ) e on true
  where en.student_id = student
    and en.session_id = session
    and public.can_see_student(student)
  group by t.email, e.id, e.name, e.designation, e.photo_path
  order by bool_or(t.is_class_teacher) desc, 2
$$;

revoke execute on function public.class_teachers_for_student(uuid, uuid) from public, anon;
grant execute on function public.class_teachers_for_student(uuid, uuid) to authenticated;
