-- A unit by itself ("Unit 1") doesn't say what it's about; a chapter name
-- alongside it does ("Unit 1 — Our Environment"). Required going forward;
-- entries from before this (no unit either) are untouched.

alter table public.syllabus add column chapter text check (chapter is null or length(trim(chapter)) <= 100);

create or replace function public.syllabus_author() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  select coalesce(nullif(trim(m.full_name), ''), split_part(m.email, '@', 1)) into new.author_name
  from public.school_members m
  where m.school_id = new.school_id and m.email = new.created_by;
  new.section := nullif(trim(new.section), '');
  new.subject := trim(new.subject);
  new.unit := nullif(trim(new.unit), '');
  new.chapter := nullif(trim(new.chapter), '');
  return new;
end
$$;

-- Adds `chapter` to the output, so the function's return type changes.
drop function public.child_syllabus(uuid);

create function public.child_syllabus(student uuid)
returns table (id uuid, subject text, unit text, chapter text, body text, author_name text, created_at timestamptz, class text, section text)
language sql stable security definer set search_path = '' as $$
  select y.id, y.subject, y.unit, y.chapter, y.body, y.author_name, y.created_at, y.class, y.section
  from public.student_enrolments e
  join public.academic_sessions a on a.id = e.session_id
  join public.syllabus y on y.session_id = e.session_id and y.class = e.class and (y.section is null or y.section = e.section)
  where e.student_id = student
    and (public.is_parent_of(student) or public.can_see_student(student))
    and e.session_id = (
      select e2.session_id from public.student_enrolments e2
      join public.academic_sessions a2 on a2.id = e2.session_id
      where e2.student_id = student order by a2.name desc limit 1
    )
  order by y.subject asc, y.created_at asc
$$;

revoke execute on function public.child_syllabus(uuid) from public, anon;
grant execute on function public.child_syllabus(uuid) to authenticated;
