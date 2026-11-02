-- AI insights for Homework (Premium), alongside Fees, Transport and Results.
--
-- ai_homework_pack(): how much homework each class, subject and teacher gave
-- lately, and which classes have no syllabus entries. Counts and dates only,
-- not what the homework says. Owners, admins and the principal.

alter table public.ai_insights drop constraint ai_insights_section_check;
alter table public.ai_insights add constraint ai_insights_section_check check (section in ('fees', 'transport', 'results', 'homework'));

drop policy "admins read insights" on public.ai_insights;
create policy "admins read insights" on public.ai_insights
  for select to authenticated using (
    public.is_school_admin(school_id) or (section in ('results', 'homework') and public.is_principal(school_id))
  );

create function public.ai_homework_pack(p_school uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  sess uuid := public.current_session(p_school);
  d date := public.ist_today();
  out jsonb;
begin
  if not (coalesce(auth.role(), '') = 'service_role' or public.is_school_admin(p_school) or public.is_principal(p_school)) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if sess is null then
    return jsonb_build_object('error', 'no session');
  end if;

  with
  cl as (
    select e.class, e.section, public.class_text(e.class, e.section) as class_name, count(*)::int as students
    from public.student_enrolments e
    where e.session_id = sess and e.status = 'active'
    group by e.class, e.section
  ),
  hw as (
    select h.class, h.section, h.subject, h.author_name, h.due_date, (h.created_at at time zone 'Asia/Kolkata')::date as given
    from public.homework h
    where h.school_id = p_school and h.session_id = sess
  ),
  -- A homework with no section is for every section of its class
  per_class as (
    select cl.class_name, cl.students,
      count(hw.given) filter (where hw.given > d - 7)::int as given_last_7_days,
      count(hw.given) filter (where hw.given > d - 30)::int as given_last_30_days,
      max(hw.given) as last_given,
      d - max(hw.given) as days_since_last
    from cl
    left join hw on hw.class = cl.class and (hw.section is null or hw.section = cl.section)
    group by cl.class_name, cl.students
  ),
  per_subject as (
    select coalesce(nullif(trim(hw.subject), ''), 'No subject') as subject,
      count(*) filter (where hw.given > d - 7)::int as given_last_7_days,
      count(*) filter (where hw.given > d - 30)::int as given_last_30_days,
      count(*)::int as given_this_session
    from hw
    group by 1
  ),
  per_teacher as (
    select coalesce(nullif(trim(hw.author_name), ''), 'Unknown') as teacher,
      count(*) filter (where hw.given > d - 7)::int as given_last_7_days,
      count(*) filter (where hw.given > d - 30)::int as given_last_30_days,
      d - max(hw.given) as days_since_last
    from hw
    group by 1
  ),
  syl as (
    select distinct s.class from public.syllabus s
    where s.school_id = p_school and s.session_id = sess
  )
  select jsonb_build_object(
    'today', d,
    'totals', jsonb_build_object(
      'classes', (select count(*) from cl),
      'given_this_session', (select count(*) from hw),
      'given_last_7_days', (select count(*) from hw where hw.given > d - 7),
      'given_last_30_days', (select count(*) from hw where hw.given > d - 30),
      'due_tomorrow', (select count(*) from hw where hw.due_date = d + 1),
      'without_due_date', (select count(*) from hw where hw.due_date is null),
      'classes_none_last_7_days', (select count(*) from per_class p where p.given_last_7_days = 0),
      'classes_none_this_session', (select count(*) from per_class p where p.last_given is null)
    ),
    'classes', coalesce((select jsonb_agg(to_jsonb(p) order by p.given_last_30_days, p.class_name) from per_class p), '[]'),
    'subjects', coalesce((select jsonb_agg(to_jsonb(p) order by p.given_last_30_days desc) from per_subject p), '[]'),
    'teachers', coalesce((select jsonb_agg(to_jsonb(p) order by p.given_last_30_days desc) from per_teacher p), '[]'),
    'grades_without_syllabus', coalesce((
      select jsonb_agg(c.class order by c.class)
      from (select distinct cl.class from cl) c
      where not exists (select 1 from syl where syl.class = c.class)
    ), '[]')
  ) into out;
  return out;
end
$$;

revoke execute on function public.ai_homework_pack(uuid) from public, anon;
grant execute on function public.ai_homework_pack(uuid) to authenticated, service_role;
