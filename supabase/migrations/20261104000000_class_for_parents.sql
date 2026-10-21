-- Parents see their child's class: its teachers (names and photos) and
-- classmates' first names only (no other children's photos or details).

-- Teachers: parents of the student may ask too.
create or replace function public.class_teachers_for_student(student uuid, session uuid)
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
    and (public.can_see_student(student) or public.is_parent_of(student))
  group by t.email, e.id, e.name, e.designation, e.photo_path
  order by bool_or(t.is_class_teacher) desc, 2
$$;

-- Classmates for a parent: first names only, active students in the same
-- class and section this session, the child left out.
create function public.classmates_for_parent(student uuid, session uuid)
returns table (first_name text)
language sql stable security definer set search_path = '' as $$
  select split_part(trim(s.name), ' ', 1)
  from public.student_enrolments mine
  join public.student_enrolments en
    on en.school_id = mine.school_id
   and en.session_id = mine.session_id
   and en.class = mine.class
   and coalesce(en.section, '') = coalesce(mine.section, '')
   and en.student_id <> mine.student_id
   and en.status = 'active'
  join public.students s on s.id = en.student_id
  where mine.student_id = student
    and mine.session_id = session
    and public.is_parent_of(student)
  order by 1
$$;

revoke execute on function public.classmates_for_parent(uuid, uuid) from public, anon;
grant execute on function public.classmates_for_parent(uuid, uuid) to authenticated;

-- Parents may load the photos of their children's teachers.
create function public.is_parent_teacher_photo(object_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.employees x
    join public.teacher_classes t on t.school_id = x.school_id and t.email = lower(x.email)
    join public.student_enrolments en
      on en.school_id = t.school_id
     and en.session_id = t.session_id
     and en.class = t.class
     and (t.section is null or t.section = en.section)
    where x.photo_path = object_name and public.is_parent_of(en.student_id)
  )
$$;

revoke execute on function public.is_parent_teacher_photo(text) from public, anon;
grant execute on function public.is_parent_teacher_photo(text) to authenticated;

create policy "parents read their children's teachers' photos" on storage.objects
  for select to authenticated using (bucket_id = 'photos' and public.is_parent_teacher_photo(name));
