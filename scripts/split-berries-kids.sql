-- Split Berries Kids School (Nursery to Grade 2) out of Mav School.
--
-- Run it in the Supabase SQL editor, as one piece. It's all or nothing.
--
--   rehearse := true   does the whole move, then cancels it and shows a
--                      report (as an error, which is what cancels it).
--                      Nothing is saved. Run this first and check the report.
--   rehearse := false  does the same move for real.
--
-- What moves to Berries: every Mav student whose latest class is Nursery to
-- Grade 2 (including Pre-nursery, LKG/UKG, KG 1/2), with everything that's
-- theirs: enrolments in every session, private details, parent links (each parent gets a Berries record; a parent
-- with children in both schools keeps both), fee dues, invoices, payments
-- and their receipts, attendance, results, messages and requests; and the
-- Nursery to Grade 2 homework, datesheets and syllabus.
--
-- Berries gets copies of Mav's sessions, its Nursery to Grade 2 classes and
-- sections, fee types and plans, the fee structure for those classes, bus
-- routes and stops, and areas. Mav's owners are owners of Berries too.
-- Notices, calendar and staff start clean. Receipt numbers carry on after
-- the highest one the moved students already have, so none can clash.
--
-- Mav loses its Nursery to Grade 2 classes, their fee structure, and
-- teachers' Nursery to Grade 2 class allocations.
--
-- Students' photos stay where they are for now (Mav's folder): the owner
-- of both can still see them. Moving the files is a separate step.

do $$
declare
  rehearse boolean := true;                                   -- set to false for the real run
  mav uuid := '5cf34cd2-b39e-422f-8ff6-79377e1b399e';         -- Mav School
  bk uuid;
  report text := '';
  n bigint;
  r record;
  t text;
  moved_tables text[] := array[
    'students', 'student_enrolments', 'student_private',
    'guardians', 'guardian_students', 'fee_dues', 'fee_invoices', 'fee_payments', 'fee_allocations',
    'attendance', 'exam_results', 'homework', 'homework_students', 'datesheets', 'syllabus',
    'messages', 'parent_requests', 'fee_schedule', 'school_grades', 'teacher_classes'
  ];
begin
  if not exists (select 1 from public.schools where id = mav and name ilike '%mav%') then
    raise exception 'Mav School (%) not found', mav;
  end if;
  if exists (select 1 from public.schools where slug = 'berries-kids') then
    raise exception 'Berries Kids School already exists: nothing done';
  end if;

  -- ------------------------------------------------ who moves ---

  -- Each Mav student's latest class (newest session they're enrolled in).
  create temp table split_latest on commit drop as
  select distinct on (e.student_id) e.student_id, e.class
  from public.student_enrolments e
  join public.academic_sessions a on a.id = e.session_id
  where e.school_id = mav
  order by e.student_id, a.name desc;

  create temp table split_students on commit drop as
  select l.student_id as id from split_latest l where public.grade_sort(l.class) <= 2;

  report := report || format(E'Mav students before: %s\n', (select count(*) from public.students where school_id = mav));
  report := report || format(E'Moving to Berries: %s\n', (select count(*) from split_students));
  report := report || E'  by latest class:\n';
  for r in
    select l.class, count(*) as c,
      bool_or(public.grade_sort(l.class) <= 2) as moves
    from split_latest l group by l.class order by min(public.grade_sort(l.class)), l.class
  loop
    report := report || format(E'    %s %s: %s\n', case when r.moves then '->' else '  ' end, r.class, r.c);
  end loop;
  report := report || format(E'Mav students not enrolled in any session (stay in Mav): %s\n',
    (select count(*) from public.students s where s.school_id = mav and not exists (select 1 from split_latest l where l.student_id = s.id)));

  -- ------------------------------------------------ the school ---

  insert into public.schools (slug, name, short_name, board, lat, lng)
  select 'berries-kids', 'Berries Kids School', 'Berries Kids', s.board, s.lat, s.lng
  from public.schools s where s.id = mav
  returning id into bk;

  insert into public.school_members (school_id, email, role, full_name, designation, phone, added_by)
  select bk, m.email, m.role, m.full_name, m.designation, m.phone, 'school split'
  from public.school_members m where m.school_id = mav and m.role = 'owner';
  get diagnostics n = row_count;
  report := report || format(E'\nBerries created (owners copied: %s)\n', n);

  -- Sessions, same names.
  create temp table split_sessions on commit drop as
  select a.id as old_id, gen_random_uuid() as new_id from public.academic_sessions a where a.school_id = mav;
  insert into public.academic_sessions (id, school_id, name, starts_on, ends_on)
  select m.new_id, bk, a.name, a.starts_on, a.ends_on
  from public.academic_sessions a join split_sessions m on m.old_id = a.id;

  -- Classes: only Nursery to Grade 2, with Mav's labels and sections.
  delete from public.school_grades where school_id = bk and public.grade_sort(code) > 2;
  insert into public.school_grades (school_id, code, label, sort, sections)
  select bk, g.code, g.label, g.sort, g.sections
  from public.school_grades g where g.school_id = mav and public.grade_sort(g.code) <= 2
  on conflict (school_id, code) do update set label = excluded.label, sort = excluded.sort, sections = excluded.sections;

  -- Fee types and plans (plans with the same name as Berries' standard ones are shared).
  create temp table split_heads on commit drop as
  select h.id as old_id, gen_random_uuid() as new_id from public.fee_heads h where h.school_id = mav;
  insert into public.fee_heads (id, school_id, name, sort, active)
  select m.new_id, bk, h.name, h.sort, h.active from public.fee_heads h join split_heads m on m.old_id = h.id;

  create temp table split_plans on commit drop as
  select p.id as old_id,
    coalesce((select b.id from public.fee_plans b where b.school_id = bk and b.name = p.name), gen_random_uuid()) as new_id,
    exists (select 1 from public.fee_plans b where b.school_id = bk and b.name = p.name) as existed
  from public.fee_plans p where p.school_id = mav;
  insert into public.fee_plans (id, school_id, name, months, due_day, is_standard, sort, due_months)
  select m.new_id, bk, p.name, p.months, p.due_day, p.is_standard, p.sort, p.due_months
  from public.fee_plans p join split_plans m on m.old_id = p.id where not m.existed;

  -- Fee structure: rows for every class, and for Nursery to Grade 2.
  insert into public.fee_schedule (school_id, session_id, class, head_id, amount, frequency, start_month, due_day, streams, plan_id, updated_by)
  select bk, sm.new_id, f.class, hm.new_id, f.amount, f.frequency, f.start_month, f.due_day, f.streams, pm.new_id, 'school split'
  from public.fee_schedule f
  join split_sessions sm on sm.old_id = f.session_id
  join split_heads hm on hm.old_id = f.head_id
  left join split_plans pm on pm.old_id = f.plan_id
  where f.school_id = mav and (f.class is null or public.grade_sort(f.class) <= 2);
  get diagnostics n = row_count;
  report := report || format(E'Fee structure rows copied: %s\n', n);

  -- Transport and areas: a full copy (the same buses serve both).
  create temp table split_routes on commit drop as
  select r2.id as old_id, gen_random_uuid() as new_id from public.bus_routes r2 where r2.school_id = mav;
  insert into public.bus_routes (id, school_id, name, sort)
  select m.new_id, bk, x.name, x.sort from public.bus_routes x join split_routes m on m.old_id = x.id;
  create temp table split_stops on commit drop as
  select s.id as old_id, gen_random_uuid() as new_id from public.bus_stops s where s.school_id = mav;
  insert into public.bus_stops (id, school_id, route_id, name, address, place_id, lat, lng, sort)
  select m.new_id, bk, rm.new_id, s.name, s.address, s.place_id, s.lat, s.lng, s.sort
  from public.bus_stops s join split_stops m on m.old_id = s.id join split_routes rm on rm.old_id = s.route_id;
  create temp table split_areas on commit drop as
  select a.id as old_id, gen_random_uuid() as new_id from public.school_areas a where a.school_id = mav;
  insert into public.school_areas (id, school_id, name, aliases, lat, lng, source)
  select m.new_id, bk, a.name, a.aliases, a.lat, a.lng, a.source from public.school_areas a join split_areas m on m.old_id = a.id;
  report := report || format(E'Bus routes / stops / areas copied: %s / %s / %s\n',
    (select count(*) from split_routes), (select count(*) from split_stops), (select count(*) from split_areas));

  -- ------------------------------------------------ the move ---

  -- Rows change school in place, so the "same school" links are lifted for
  -- the move and put back at the end, which re-checks every row in every
  -- table: anything left pointing across schools stops the whole run.
  create temp table split_fks on commit drop as
  select c.conrelid::regclass::text as tbl, c.conname, pg_get_constraintdef(c.oid) as def
  from pg_constraint c
  join pg_namespace ns on ns.oid = c.connamespace
  where ns.nspname = 'public' and c.contype = 'f'
    and exists (
      select 1 from unnest(c.conkey) k
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k
      where a.attname = 'school_id'
    );
  for r in select * from split_fks loop
    execute format('alter table %s drop constraint %I', r.tbl, r.conname);
  end loop;
  -- No automatic side effects (touch times, parent auto-links) while moving.
  foreach t in array moved_tables loop
    execute format('alter table public.%I disable trigger user', t);
  end loop;

  update public.students set school_id = bk where id in (select id from split_students);
  report := report || E'\nMoved rows:\n' || format(E'  students: %s\n', (select count(*) from split_students));

  update public.student_enrolments e set school_id = bk, session_id = sm.new_id
  from split_sessions sm where sm.old_id = e.session_id and e.student_id in (select id from split_students);
  get diagnostics n = row_count; report := report || format(E'  enrolments: %s\n', n);

  update public.student_private p set school_id = bk,
    bus_stop_id = (select m.new_id from split_stops m where m.old_id = p.bus_stop_id),
    area_id = (select m.new_id from split_areas m where m.old_id = p.area_id)
  where p.student_id in (select id from split_students);
  get diagnostics n = row_count; report := report || format(E'  private details: %s\n', n);

  -- Parents: a Berries record per parent of a moving child.
  create temp table split_guardians on commit drop as
  select g.id as old_id, gen_random_uuid() as new_id
  from public.guardians g
  where g.school_id = mav
    and exists (select 1 from public.guardian_students gs where gs.guardian_id = g.id and gs.student_id in (select id from split_students));
  insert into public.guardians (id, school_id, phone, name, updated_by)
  select m.new_id, bk, g.phone, g.name, 'school split' from public.guardians g join split_guardians m on m.old_id = g.id;
  update public.guardian_students gs set guardian_id = m.new_id, school_id = bk
  from split_guardians m where gs.guardian_id = m.old_id and gs.student_id in (select id from split_students);
  update public.parent_requests pr set guardian_id = m.new_id
  from split_guardians m where pr.guardian_id = m.old_id and pr.student_id in (select id from split_students);
  delete from public.guardians g using split_guardians m
  where g.id = m.old_id and not exists (select 1 from public.guardian_students gs where gs.guardian_id = g.id);
  get diagnostics n = row_count;
  report := report || format(E'  parents: %s (with children in both schools, kept in Mav too: %s)\n',
    (select count(*) from split_guardians), (select count(*) from split_guardians) - n);

  update public.fee_dues d set school_id = bk, session_id = sm.new_id
  from split_sessions sm where sm.old_id = d.session_id and d.student_id in (select id from split_students);
  get diagnostics n = row_count; report := report || format(E'  fee dues: %s\n', n);
  update public.fee_invoices i set school_id = bk, session_id = sm.new_id, head_id = hm.new_id
  from split_sessions sm, split_heads hm
  where sm.old_id = i.session_id and hm.old_id = i.head_id and i.student_id in (select id from split_students);
  get diagnostics n = row_count; report := report || format(E'  fee invoices: %s\n', n);
  update public.fee_payments set school_id = bk where student_id in (select id from split_students);
  get diagnostics n = row_count; report := report || format(E'  fee payments: %s\n', n);
  update public.fee_allocations a set school_id = bk
  where a.payment_id in (select p.id from public.fee_payments p where p.school_id = bk);
  get diagnostics n = row_count; report := report || format(E'  payment allocations: %s\n', n);

  update public.attendance x set school_id = bk, session_id = sm.new_id
  from split_sessions sm where sm.old_id = x.session_id and x.student_id in (select id from split_students);
  get diagnostics n = row_count; report := report || format(E'  attendance days: %s\n', n);
  update public.exam_results x set school_id = bk, session_id = sm.new_id
  from split_sessions sm where sm.old_id = x.session_id and x.student_id in (select id from split_students);
  get diagnostics n = row_count; report := report || format(E'  exam results: %s\n', n);

  update public.messages set school_id = bk where student_id in (select id from split_students);
  get diagnostics n = row_count; report := report || format(E'  messages: %s\n', n);
  update public.parent_requests set school_id = bk where student_id in (select id from split_students);
  get diagnostics n = row_count; report := report || format(E'  parent requests: %s\n', n);

  -- Nursery to Grade 2 class work.
  update public.homework x set school_id = bk, session_id = sm.new_id
  from split_sessions sm where sm.old_id = x.session_id and x.school_id = mav and public.grade_sort(x.class) <= 2;
  get diagnostics n = row_count; report := report || format(E'  homework: %s\n', n);
  update public.homework_students hs set school_id = bk
  where hs.homework_id in (select x.id from public.homework x where x.school_id = bk);
  update public.datesheets x set school_id = bk, session_id = sm.new_id
  from split_sessions sm where sm.old_id = x.session_id and x.school_id = mav and public.grade_sort(x.class) <= 2;
  get diagnostics n = row_count; report := report || format(E'  datesheet entries: %s\n', n);
  update public.syllabus x set school_id = bk, session_id = sm.new_id
  from split_sessions sm where sm.old_id = x.session_id and x.school_id = mav and public.grade_sort(x.class) <= 2;
  get diagnostics n = row_count; report := report || format(E'  syllabus entries: %s\n', n);

  -- What Mav no longer has.
  delete from public.teacher_classes where school_id = mav and public.grade_sort(class) <= 2;
  get diagnostics n = row_count; report := report || format(E'\nMav teacher allocations to Nursery-Grade 2 removed: %s\n', n);
  delete from public.fee_schedule where school_id = mav and class is not null and public.grade_sort(class) <= 2;
  get diagnostics n = row_count; report := report || format(E'Mav Nursery-Grade 2 fee structure rows removed: %s\n', n);
  delete from public.school_grades where school_id = mav and public.grade_sort(code) <= 2;
  get diagnostics n = row_count; report := report || format(E'Mav Nursery-Grade 2 classes removed: %s\n', n);

  -- Receipts carry on after the moved ones.
  insert into public.school_counters (school_id, name, value)
  select bk, 'receipt', coalesce(max(nullif(regexp_replace(p.receipt_no, '\D', '', 'g'), '')::bigint), 0)
  from public.fee_payments p where p.school_id = bk;
  report := report || format(E'Berries receipts continue after: R-%s\n',
    lpad((select value from public.school_counters where school_id = bk and name = 'receipt')::text, 6, '0'));

  -- Put the links back (each one re-checks its whole table) and the triggers.
  foreach t in array moved_tables loop
    execute format('alter table public.%I enable trigger user', t);
  end loop;
  for r in select * from split_fks loop
    execute format('alter table %s add constraint %I %s', r.tbl, r.conname, r.def);
  end loop;
  report := report || format(E'Links re-checked: %s, all good\n', (select count(*) from split_fks));

  report := report || format(E'\nAfter: Mav students %s, Berries students %s\n',
    (select count(*) from public.students where school_id = mav),
    (select count(*) from public.students where school_id = bk));

  if rehearse then
    raise exception E'REHEARSAL ONLY. Nothing was saved.\n\n%', report;
  end if;
  raise notice E'DONE. Berries Kids School id: %\n\n%', bk, report;
end
$$;
