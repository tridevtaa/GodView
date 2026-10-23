-- Weekly timetable: which subject (and teacher) a class/section has in each
-- period, each day. Set up the same way as attendance — owners and admins
-- set any class; a class's own class teacher (teacher_classes.is_class_teacher)
-- sets just that class. Any teacher who teaches the class, or is named as a
-- slot's own teacher, can see it; so can parents, for their child's class.
-- Period numbers only for now, no fixed clock times.

create table public.timetable_slots (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  session_id uuid not null,
  class text not null,
  section text, -- null = every section of the class (same convention as datesheets)
  day_of_week smallint not null check (day_of_week between 1 and 7), -- 1 = Monday
  period_no smallint not null check (period_no between 1 and 20),
  subject text not null check (length(trim(subject)) between 1 and 80),
  teacher_email text check (teacher_email is null or teacher_email = lower(teacher_email)),
  updated_at timestamptz not null default now(),
  updated_by text,
  foreign key (session_id, school_id) references public.academic_sessions (id, school_id) on delete cascade,
  -- The add-timetable screen always sends a concrete section (possibly ''
  -- for a school that doesn't split sections), never null, so a plain
  -- constraint is enough; null stays available for a future "whole class"
  -- option the same way datesheets.section works.
  unique (school_id, session_id, class, section, day_of_week, period_no)
);

create index timetable_slots_class on public.timetable_slots (school_id, session_id, class);
create index timetable_slots_teacher on public.timetable_slots (school_id, session_id, teacher_email);

create function public.timetable_slot_clean() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.section := nullif(trim(new.section), '');
  new.subject := trim(new.subject);
  new.teacher_email := nullif(lower(trim(coalesce(new.teacher_email, ''))), '');
  return new;
end
$$;

revoke execute on function public.timetable_slot_clean() from public, anon, authenticated;

create trigger timetable_slots_clean before insert or update on public.timetable_slots
  for each row execute function public.timetable_slot_clean();
create trigger timetable_slots_touch before insert or update on public.timetable_slots
  for each row execute function public.touch();

-- May the caller set this class's timetable? Same split as attendance:
-- admins any class, a class teacher just their own class.
create function public.can_edit_timetable(school uuid, session uuid, klass text, sec text) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_school_admin(school) or exists (
    select 1 from public.teacher_classes t
    where t.school_id = school and t.session_id = session and t.email = public.current_email()
      and t.class = klass and (t.section is null or sec is null or t.section = sec)
      and t.is_class_teacher
  )
$$;

revoke execute on function public.can_edit_timetable(uuid, uuid, text, text) from public, anon;
grant execute on function public.can_edit_timetable(uuid, uuid, text, text) to authenticated;

alter table public.timetable_slots enable row level security;
grant select, insert, update, delete on public.timetable_slots to authenticated;

create policy "staff of the class or the slot's teacher read timetable" on public.timetable_slots
  for select to authenticated using (
    teacher_email = public.current_email() or public.teaches_class(school_id, session_id, class, section)
  );
create policy "class teachers and admins set timetable" on public.timetable_slots
  for insert to authenticated with check (public.can_edit_timetable(school_id, session_id, class, section));
create policy "class teachers and admins update timetable" on public.timetable_slots
  for update to authenticated using (public.can_edit_timetable(school_id, session_id, class, section))
  with check (public.can_edit_timetable(school_id, session_id, class, section));
create policy "class teachers and admins remove timetable" on public.timetable_slots
  for delete to authenticated using (public.can_edit_timetable(school_id, session_id, class, section));

-- One child's weekly timetable (their class and section this session). For
-- their parents and for staff who can see them. Teacher names resolved the
-- same way as class_teachers_for_student.
create function public.child_timetable(student uuid)
returns table (day_of_week smallint, period_no smallint, subject text, teacher_name text, class text, section text)
language sql stable security definer set search_path = '' as $$
  select x.day_of_week, x.period_no, x.subject,
    coalesce(nullif(trim(emp.name), ''), split_part(x.teacher_email, '@', 1)),
    x.class, x.section
  from public.student_enrolments en
  -- x.section is always a real string (never null, see saveTimetableSlot),
  -- so a sectionless student's null en.section needs normalising to '' to
  -- still match it.
  join public.timetable_slots x on x.session_id = en.session_id and x.class = en.class and (x.section is null or x.section = coalesce(en.section, ''))
  left join lateral (
    select e.name from public.employees e
    where e.school_id = en.school_id and lower(e.email) = x.teacher_email
    order by (e.status = 'active') desc
    limit 1
  ) emp on true
  where en.student_id = student
    and (public.is_parent_of(student) or public.can_see_student(student))
    and en.session_id = (
      select e2.session_id from public.student_enrolments e2
      join public.academic_sessions a2 on a2.id = e2.session_id
      where e2.student_id = student order by a2.name desc limit 1
    )
  order by x.day_of_week, x.period_no
$$;

revoke execute on function public.child_timetable(uuid) from public, anon;
grant execute on function public.child_timetable(uuid) to authenticated;
