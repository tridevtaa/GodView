-- The student page (and parents' Home) show what each teacher teaches: the
-- subjects on their staff record, or, if that's empty, what they wrote when
-- they asked to join. The return type changes, so the function is replaced.

drop function public.class_teachers_for_student(uuid, uuid);

create function public.class_teachers_for_student(student uuid, session uuid)
returns table (id uuid, name text, designation text, photo_path text, is_class_teacher boolean, subjects text)
language sql stable security definer set search_path = '' as $$
  select
    e.id,
    coalesce(e.name, split_part(t.email, '@', 1)) as name,
    e.designation,
    e.photo_path,
    bool_or(t.is_class_teacher) as is_class_teacher,
    coalesce(
      nullif(trim(e.subjects), ''),
      (
        select nullif(trim(r.subjects), '')
        from public.access_requests r
        where r.school_id = t.school_id and r.email = t.email and nullif(trim(r.subjects), '') is not null
        order by r.created_at desc
        limit 1
      )
    ) as subjects
  from public.student_enrolments en
  join public.teacher_classes t
    on t.school_id = en.school_id
   and t.session_id = en.session_id
   and t.class = en.class
   and (t.section is null or t.section = en.section)
  left join lateral (
    select x.id, x.name, x.designation, x.photo_path, x.subjects
    from public.employees x
    where x.school_id = t.school_id and lower(x.email) = t.email and x.status <> 'left'
    order by (x.status = 'active') desc
    limit 1
  ) e on true
  where en.student_id = student
    and en.session_id = session
    and (public.can_see_student(student) or public.is_parent_of(student))
  group by t.school_id, t.email, e.id, e.name, e.designation, e.photo_path, e.subjects
  order by bool_or(t.is_class_teacher) desc, 2
$$;

revoke execute on function public.class_teachers_for_student(uuid, uuid) from public, anon;
grant execute on function public.class_teachers_for_student(uuid, uuid) to authenticated;
