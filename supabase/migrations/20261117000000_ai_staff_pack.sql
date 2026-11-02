-- AI insights for Staff (Premium). Owners and admins only.
--
-- ai_staff_pack(): counts only, with no staff names, phone numbers or other
-- personal details: who teaches, departments, gaps in staff records, classes
-- with no class teacher, teachers with no class, people waiting for access.

alter table public.ai_insights drop constraint ai_insights_section_check;
alter table public.ai_insights add constraint ai_insights_section_check check (section in ('fees', 'transport', 'results', 'homework', 'staff'));

create function public.ai_staff_pack(p_school uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  sess uuid := public.current_session(p_school);
  d date := public.ist_today();
  out jsonb;
begin
  if not (coalesce(auth.role(), '') = 'service_role' or public.is_school_admin(p_school)) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if sess is null then
    return jsonb_build_object('error', 'no session');
  end if;

  with
  -- Who teaches: the same words the Staff page goes by
  st as (
    select x.*, (coalesce(x.designation, '') || ' ' || coalesce(x.department, '')) ~* 'teach|prt|tgt|pgt|lecturer|faculty' as teaches
    from public.employees x
    where x.school_id = p_school and x.status = 'active'
  ),
  cl as (
    select e.class, e.section, count(*)::int as students
    from public.student_enrolments e
    where e.session_id = sess and e.status = 'active'
    group by e.class, e.section
  ),
  tc as (
    select t.email, t.class, t.section, t.is_class_teacher
    from public.teacher_classes t
    where t.school_id = p_school and t.session_id = sess
  )
  select jsonb_build_object(
    'today', d,
    'totals', jsonb_build_object(
      'active_staff', (select count(*) from st),
      'teaching', (select count(*) from st where st.teaches),
      'not_teaching', (select count(*) from st where not st.teaches),
      'inactive_staff', (select count(*) from public.employees x where x.school_id = p_school and x.status = 'inactive'),
      'joined_last_90_days', (select count(*) from st where st.joining_date > d - 90),
      'waiting_for_app_access', (select count(*) from public.access_requests r where r.school_id = p_school and r.status = 'pending'),
      'active_students', (select coalesce(sum(cl.students), 0) from cl),
      'students_per_teaching_staff', (
        select round(coalesce(sum(cl.students), 0)::numeric / nullif((select count(*) from st where st.teaches), 0), 1) from cl
      )
    ),
    'record_gaps', jsonb_build_object(
      'no_phone', (select count(*) from st where nullif(trim(st.phone), '') is null),
      'no_email', (select count(*) from st where nullif(trim(st.email), '') is null),
      'no_photo', (select count(*) from st where st.photo_path is null),
      'no_joining_date', (select count(*) from st where st.joining_date is null),
      'no_department', (select count(*) from st where nullif(trim(st.department), '') is null),
      'no_designation', (select count(*) from st where nullif(trim(st.designation), '') is null)
    ),
    'teaching_gaps', jsonb_build_object(
      'classes', (select count(*) from cl),
      -- A class teacher set for every section of a class covers each of them
      'classes_without_class_teacher', coalesce((
        select jsonb_agg(public.class_text(cl.class, cl.section) order by cl.class, cl.section)
        from cl
        where not exists (
          select 1 from tc where tc.is_class_teacher and tc.class = cl.class and (tc.section is null or tc.section = cl.section)
        )
      ), '[]'),
      'teaching_staff_with_no_class', (
        select count(*) from st
        where st.teaches and not exists (select 1 from tc where tc.email = lower(st.email))
      )
    ),
    'departments', coalesce((
      select jsonb_agg(jsonb_build_object('department', g.department, 'staff', g.n) order by g.n desc)
      from (
        select coalesce(nullif(trim(st.department), ''), 'Not set') as department, count(*)::int as n
        from st group by 1
      ) g
    ), '[]')
  ) into out;
  return out;
end
$$;

revoke execute on function public.ai_staff_pack(uuid) from public, anon;
grant execute on function public.ai_staff_pack(uuid) to authenticated, service_role;
