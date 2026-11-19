-- Role permissions: the owner decides what admins, principals and
-- teachers can do in ten areas (Off, View or Edit), and can make an
-- exception for one person. Owners always have everything.
--
-- Areas: fees, admissions, certificates, transport, staff, students
-- (student details: contact, address, documents), attendance, results,
-- notices, assistant (Goddess and AI insights; Off or On).
--
-- Teachers only ever work with their own classes, so their settings cover
-- attendance, results, students and notices, inside those classes. The
-- other areas are school-wide and stay off for teachers.
--
-- With no settings saved, everyone keeps exactly what they had
-- (default_level), apart from principals now also seeing the staff
-- section of AI insights, as they already see the staff list.
--
-- Enforced here, in the database: every rule and function for those areas
-- asks can() or can_wide() instead of the fixed roles.

-- ------------------------------------------------------------- settings ---

create table public.role_permissions (
  school_id uuid not null references public.schools (id) on delete cascade,
  role public.member_role not null check (role::text in ('admin', 'principal', 'teacher')),
  area text not null check (area in ('fees', 'admissions', 'certificates', 'transport', 'staff', 'students', 'attendance', 'results', 'notices', 'assistant')),
  level smallint not null check (level between 0 and 2),
  updated_at timestamptz not null default now(),
  updated_by text,
  primary key (school_id, role, area),
  check (role::text <> 'teacher' or area in ('attendance', 'results', 'students', 'notices')),
  check (area <> 'assistant' or level in (0, 2))
);

-- One person's exceptions; removed with their access.
create table public.member_permissions (
  school_id uuid not null,
  email text not null,
  area text not null check (area in ('fees', 'admissions', 'certificates', 'transport', 'staff', 'students', 'attendance', 'results', 'notices', 'assistant')),
  level smallint not null check (level between 0 and 2),
  updated_at timestamptz not null default now(),
  updated_by text,
  primary key (school_id, email, area),
  foreign key (school_id, email) references public.school_members (school_id, email) on delete cascade,
  check (area <> 'assistant' or level in (0, 2))
);

alter table public.role_permissions enable row level security;
alter table public.member_permissions enable row level security;

create policy "owner manages role permissions" on public.role_permissions
  for all to authenticated using (public.is_owner(school_id)) with check (public.is_owner(school_id));
create policy "owner manages member permissions" on public.member_permissions
  for all to authenticated using (public.is_owner(school_id)) with check (public.is_owner(school_id));

grant select, insert, update, delete on public.role_permissions, public.member_permissions to authenticated;

create trigger role_permissions_touch before insert or update on public.role_permissions
  for each row execute function public.touch();
create trigger member_permissions_touch before insert or update on public.member_permissions
  for each row execute function public.touch();

-- ---------------------------------------------------------------- levels ---

-- What each role had before settings existed: 0 off, 1 view, 2 edit.
create function public.default_level(p_role text, p_area text) returns smallint
language sql immutable set search_path = '' as $$
  select (case
    when p_role in ('owner', 'admin') then 2
    when p_role = 'principal' then
      case p_area when 'notices' then 2 when 'assistant' then 2
        when 'admissions' then 1 when 'staff' then 1 when 'students' then 1 when 'attendance' then 1 when 'results' then 1
        else 0 end
    when p_role = 'teacher' then
      case p_area when 'attendance' then 2 when 'results' then 2 when 'notices' then 2 else 0 end
    else 0
  end)::smallint
$$;

-- The signed-in person's level in an area of a school. Teachers never get
-- the school-wide areas, whatever is saved.
create function public.access_level(p_school uuid, p_area text) returns smallint
language sql stable security definer set search_path = '' as $$
  select coalesce((
    select (case
      when m.role = 'owner' then 2
      when m.role::text = 'teacher' and p_area not in ('attendance', 'results', 'students', 'notices') then 0
      else coalesce(mp.level, rp.level, public.default_level(m.role::text, p_area))
    end)::smallint
    from public.school_members m
    left join public.member_permissions mp on mp.school_id = m.school_id and mp.email = m.email and mp.area = p_area
    left join public.role_permissions rp on rp.school_id = m.school_id and rp.role = m.role and rp.area = p_area
    where m.school_id = p_school and m.email = public.current_email()
  ), 0::smallint)
$$;

-- At least this level, any role (teachers: combined with their class scope
-- in the rule that asks).
create function public.can(p_school uuid, p_area text, p_level integer default 1) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.access_level(p_school, p_area) >= p_level
$$;

-- At least this level across the whole school: owners, admins and
-- principals only.
create function public.can_wide(p_school uuid, p_area text, p_level integer default 1) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.school_members m
    where m.school_id = p_school and m.email = public.current_email() and m.role::text <> 'teacher'
  ) and public.access_level(p_school, p_area) >= p_level
$$;

-- Storage paths start with the school id.
create function public.can_wide_folder(object_name text, p_area text, p_level integer default 1) returns boolean
language sql stable security definer set search_path = '' as $$
  select split_part(object_name, '/', 1) ~ '^[0-9a-f-]{36}$'
    and public.can_wide(split_part(object_name, '/', 1)::uuid, p_area, p_level)
$$;

-- AI insights: Goddess on, and the section's own area.
create function public.can_see_insight(p_school uuid, p_section text) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.can_wide(p_school, 'assistant', 1) and case p_section
    when 'fees' then public.can_wide(p_school, 'fees', 1)
    when 'transport' then public.can_wide(p_school, 'transport', 1)
    when 'staff' then public.can_wide(p_school, 'staff', 1)
    when 'results' then public.can_wide(p_school, 'results', 1)
    when 'homework' then true
    else public.is_school_admin(p_school)
  end
$$;

-- Every area's level for the signed-in person, for the app's screens.
create function public.my_permissions(p_school uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_object_agg(a, public.access_level(p_school, a))
  from unnest(array['fees', 'admissions', 'certificates', 'transport', 'staff', 'students', 'attendance', 'results', 'notices', 'assistant']) a
$$;

revoke execute on function public.access_level(uuid, text) from public, anon;
revoke execute on function public.can(uuid, text, integer) from public, anon;
revoke execute on function public.can_wide(uuid, text, integer) from public, anon;
revoke execute on function public.can_wide_folder(text, text, integer) from public, anon;
revoke execute on function public.can_see_insight(uuid, text) from public, anon;
revoke execute on function public.my_permissions(uuid) from public, anon;
grant execute on function public.access_level(uuid, text) to authenticated;
grant execute on function public.can(uuid, text, integer) to authenticated;
grant execute on function public.can_wide(uuid, text, integer) to authenticated;
grant execute on function public.can_wide_folder(text, text, integer) to authenticated;
grant execute on function public.can_see_insight(uuid, text) to authenticated;
grant execute on function public.my_permissions(uuid) to authenticated;

-- The same check as a set: the schools where the signed-in person has at
-- least this level. Rules use "school_id in (select ...)", which runs once
-- per query instead of once per row.
create function public.schools_with(p_area text, p_level integer default 1) returns setof uuid
language sql stable security definer set search_path = '' as $$
  select m.school_id
  from public.school_members m
  left join public.member_permissions mp on mp.school_id = m.school_id and mp.email = m.email and mp.area = p_area
  left join public.role_permissions rp on rp.school_id = m.school_id and rp.role = m.role and rp.area = p_area
  where m.email = public.current_email()
    and (case
      when m.role = 'owner' then 2
      when m.role::text = 'teacher' and p_area not in ('attendance', 'results', 'students', 'notices') then 0
      else coalesce(mp.level, rp.level, public.default_level(m.role::text, p_area))
    end) >= p_level
$$;

-- Owners, admins and principals only.
create function public.schools_wide(p_area text, p_level integer default 1) returns setof uuid
language sql stable security definer set search_path = '' as $$
  select s from public.schools_with(p_area, p_level) s
  where exists (
    select 1 from public.school_members m
    where m.school_id = s and m.email = public.current_email() and m.role::text <> 'teacher'
  )
$$;

revoke execute on function public.schools_with(text, integer) from public, anon;
revoke execute on function public.schools_wide(text, integer) from public, anon;
grant execute on function public.schools_with(text, integer) to authenticated;
grant execute on function public.schools_wide(text, integer) to authenticated;

-- ----------------------------------------------------------------- rules ---

-- Fees
drop policy "admins read allocations" on public.fee_allocations;
create policy "fees viewers read allocations" on public.fee_allocations
  for select to authenticated using (school_id in (select public.schools_wide('fees', 1)));

drop policy "admins manage fee dues" on public.fee_dues;
create policy "fees viewers read fee dues" on public.fee_dues
  for select to authenticated using (school_id in (select public.schools_wide('fees', 1)));
create policy "fees editors manage fee dues" on public.fee_dues
  for all to authenticated using (school_id in (select public.schools_wide('fees', 2))) with check (school_id in (select public.schools_wide('fees', 2)));

drop policy "admins read fee heads" on public.fee_heads;
create policy "fees viewers read fee heads" on public.fee_heads
  for select to authenticated using (school_id in (select public.schools_wide('fees', 1)));

drop policy "admins manage dues" on public.fee_invoices;
create policy "fees viewers read dues" on public.fee_invoices
  for select to authenticated using (school_id in (select public.schools_wide('fees', 1)));
create policy "fees editors manage dues" on public.fee_invoices
  for all to authenticated using (school_id in (select public.schools_wide('fees', 2))) with check (school_id in (select public.schools_wide('fees', 2)));

drop policy "admins read payments" on public.fee_payments;
create policy "fees viewers read payments" on public.fee_payments
  for select to authenticated using (school_id in (select public.schools_wide('fees', 1)));

drop policy "admins read fee plans" on public.fee_plans;
create policy "fees viewers read fee plans" on public.fee_plans
  for select to authenticated using (school_id in (select public.schools_wide('fees', 1)));

drop policy "admins read fee schedule" on public.fee_schedule;
create policy "fees viewers read fee schedule" on public.fee_schedule
  for select to authenticated using (school_id in (select public.schools_wide('fees', 1)));

-- Admissions
drop policy "admins manage admissions" on public.admissions;
drop policy "principal reads admissions" on public.admissions;
create policy "admissions viewers read" on public.admissions
  for select to authenticated using (school_id in (select public.schools_wide('admissions', 1)));
create policy "admissions editors manage" on public.admissions
  for all to authenticated using (school_id in (select public.schools_wide('admissions', 2))) with check (school_id in (select public.schools_wide('admissions', 2)));

-- Certificates
drop policy "admins read certificates" on public.student_certificates;
create policy "certificates viewers read" on public.student_certificates
  for select to authenticated using (school_id in (select public.schools_wide('certificates', 1)));

-- Transport: everyone in the school still reads routes and stops (parents
-- and teachers see the buses); managing them follows the setting.
drop policy "admins manage bus routes" on public.bus_routes;
create policy "transport editors manage bus routes" on public.bus_routes
  for all to authenticated using (school_id in (select public.schools_wide('transport', 2))) with check (school_id in (select public.schools_wide('transport', 2)));
drop policy "admins manage bus stops" on public.bus_stops;
create policy "transport editors manage bus stops" on public.bus_stops
  for all to authenticated using (school_id in (select public.schools_wide('transport', 2))) with check (school_id in (select public.schools_wide('transport', 2)));
drop policy "admins manage buses" on public.buses;
create policy "transport editors manage buses" on public.buses
  for all to authenticated using (school_id in (select public.schools_wide('transport', 2))) with check (school_id in (select public.schools_wide('transport', 2)));
drop policy "admins manage areas" on public.school_areas;
create policy "transport viewers read areas" on public.school_areas
  for select to authenticated using (school_id in (select public.schools_wide('transport', 1)));
create policy "transport editors manage areas" on public.school_areas
  for all to authenticated using (school_id in (select public.schools_wide('transport', 2))) with check (school_id in (select public.schools_wide('transport', 2)));

-- Staff records and join requests; join requests (with their KYC
-- documents) and parent records stay with owners and admins, as before.
-- (The staff list of app users and class
-- assignments stay readable as before: other screens show those names).
drop policy "admins read employees" on public.employees;
drop policy "principal reads employees" on public.employees;
drop policy "admins add employees" on public.employees;
drop policy "admins edit employees" on public.employees;
create policy "staff viewers read employees" on public.employees
  for select to authenticated using (school_id in (select public.schools_wide('staff', 1)));
create policy "staff editors add employees" on public.employees
  for insert to authenticated with check (school_id in (select public.schools_wide('staff', 2)));
create policy "staff editors edit employees" on public.employees
  for update to authenticated using (school_id in (select public.schools_wide('staff', 2))) with check (school_id in (select public.schools_wide('staff', 2)));

drop policy "requesters see their own, admins see school's" on public.access_requests;
create policy "requesters see their own, staff viewers see school's" on public.access_requests
  for select to authenticated using (
    email = public.current_email() or (school_id in (select public.schools_wide('staff', 1)) and public.is_school_admin(school_id))
  );

-- Student details (contact, address, documents)
drop policy "admins manage personal details" on public.student_private;
drop policy "principal reads student details" on public.student_private;
create policy "student details viewers read" on public.student_private
  for select to authenticated using (
    school_id in (select public.schools_wide('students', 1)) or (school_id in (select public.schools_with('students', 1)) and public.can_see_student(student_id))
  );
create policy "student details editors manage" on public.student_private
  for all to authenticated using (school_id in (select public.schools_wide('students', 2))) with check (school_id in (select public.schools_wide('students', 2)));

drop policy "admins manage guardians" on public.guardians;
create policy "student details viewers read guardians" on public.guardians
  for select to authenticated using (school_id in (select public.schools_wide('students', 1)) and public.is_school_admin(school_id));
create policy "student details editors manage guardians" on public.guardians
  for all to authenticated using (school_id in (select public.schools_wide('students', 2))) with check (school_id in (select public.schools_wide('students', 2)));

drop policy "admins manage guardian links" on public.guardian_students;
create policy "student details viewers read guardian links" on public.guardian_students
  for select to authenticated using (school_id in (select public.schools_wide('students', 1)) and public.is_school_admin(school_id));
create policy "student details editors manage guardian links" on public.guardian_students
  for all to authenticated using (school_id in (select public.schools_wide('students', 2))) with check (school_id in (select public.schools_wide('students', 2)));

drop policy "admins and class teachers see student documents" on storage.objects;
create policy "student details viewers see student documents" on storage.objects
  for select to authenticated using (
    bucket_id = 'student-documents' and (public.can_wide_folder(name, 'students', 1) or public.can_see_student_document(name))
  );
drop policy "admins upload student documents" on storage.objects;
create policy "student details editors upload student documents" on storage.objects
  for insert to authenticated with check (bucket_id = 'student-documents' and public.can_wide_folder(name, 'students', 2));
drop policy "admins replace student documents" on storage.objects;
create policy "student details editors replace student documents" on storage.objects
  for update to authenticated
  using (bucket_id = 'student-documents' and public.can_wide_folder(name, 'students', 2))
  with check (bucket_id = 'student-documents' and public.can_wide_folder(name, 'students', 2));
drop policy "admins delete student documents" on storage.objects;
create policy "student details editors delete student documents" on storage.objects
  for delete to authenticated using (bucket_id = 'student-documents' and public.can_wide_folder(name, 'students', 2));

-- Attendance (marking goes through can_mark_attendance, below)
drop policy "principal reads attendance" on public.attendance;
drop policy "staff who see the student read attendance" on public.attendance;
create policy "attendance viewers read" on public.attendance
  for select to authenticated using (
    school_id in (select public.schools_wide('attendance', 1)) or (school_id in (select public.schools_with('attendance', 1)) and public.can_see_student(student_id))
  );
drop policy "admins remove attendance" on public.attendance;
create policy "attendance editors remove" on public.attendance
  for delete to authenticated using (school_id in (select public.schools_wide('attendance', 2)));

-- Results
drop policy "principal reads results" on public.exam_results;
drop policy "see results of visible students" on public.exam_results;
create policy "results viewers read" on public.exam_results
  for select to authenticated using (
    school_id in (select public.schools_wide('results', 1)) or (school_id in (select public.schools_with('results', 1)) and public.can_see_student(student_id))
  );
drop policy "enter results for visible students" on public.exam_results;
create policy "results editors enter" on public.exam_results
  for insert to authenticated with check (
    school_id in (select public.schools_wide('results', 2)) or (school_id in (select public.schools_with('results', 2)) and public.can_see_student(student_id))
  );
drop policy "update results for visible students" on public.exam_results;
create policy "results editors update" on public.exam_results
  for update to authenticated
  using (school_id in (select public.schools_wide('results', 2)) or (school_id in (select public.schools_with('results', 2)) and public.can_see_student(student_id)))
  with check (school_id in (select public.schools_wide('results', 2)) or (school_id in (select public.schools_with('results', 2)) and public.can_see_student(student_id)));
drop policy "enterers or admins delete results" on public.exam_results;
create policy "results editors delete" on public.exam_results
  for delete to authenticated using (
    school_id in (select public.schools_with('results', 2))
    and (entered_by = public.current_email() or public.is_school_admin(school_id))
  );

-- Notices: Off hides the staff noticeboard, View reads it, Edit posts
-- (and owners and admins with Edit change anyone's, as before).
drop policy "staff and parents read notices" on public.notices;
create policy "staff and parents read notices" on public.notices
  for select to authenticated using (
    school_id in (select public.schools_with('notices', 1)) or (for_parents and public.is_parent_in_school(school_id))
  );
drop policy "staff post notices" on public.notices;
create policy "staff post notices" on public.notices
  for insert to authenticated with check (
    school_id in (select public.schools_with('notices', 2)) and created_by = public.current_email()
  );
drop policy "authors or admins change notices" on public.notices;
create policy "authors or admins change notices" on public.notices
  for update to authenticated
  using (school_id in (select public.schools_with('notices', 2)) and (created_by = public.current_email() or public.is_school_admin(school_id)))
  with check (public.is_member(school_id));
drop policy "authors or admins remove notices" on public.notices;
create policy "authors or admins remove notices" on public.notices
  for delete to authenticated using (
    school_id in (select public.schools_with('notices', 2)) and (created_by = public.current_email() or public.is_school_admin(school_id))
  );

-- AI insights
drop policy "admins read insights" on public.ai_insights;
create policy "insight viewers read" on public.ai_insights
  for select to authenticated using (public.can_see_insight(school_id, section));

-- ------------------------------------------------------------- functions ---
-- Same functions as before, each asking its area instead of the fixed role.

CREATE OR REPLACE FUNCTION public.record_payment(p_student uuid, p_amount numeric, p_method text, p_reference text, p_paid_on date, p_note text)
 RETURNS TABLE(payment_id uuid, receipt_no text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  s public.students;
  pid uuid;
  rno text;
  remaining numeric := p_amount;
  due record;
  take numeric;
begin
  select * into s from public.students where id = p_student;
  if s.id is null or not public.can_wide(s.school_id, 'fees', 2) then
    raise exception 'not allowed';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'amount must be more than zero';
  end if;

  -- Serialise payments for this student so two at once can't pay the same due.
  perform 1 from public.fee_invoices where student_id = p_student for update;

  rno := public.next_receipt_no(s.school_id);
  insert into public.fee_payments (school_id, student_id, amount, method, reference, paid_on, receipt_no, received_by, note)
  values (s.school_id, p_student, p_amount, p_method, nullif(trim(p_reference), ''), coalesce(p_paid_on, current_date),
          rno, public.current_email(), nullif(trim(p_note), ''))
  returning id into pid;

  for due in
    select b.id, b.balance
    from public.fee_invoice_balances b
    where b.student_id = p_student and b.balance > 0
    order by b.due_date nulls first, b.created_at
  loop
    exit when remaining <= 0;
    take := least(remaining, due.balance);
    insert into public.fee_allocations (payment_id, invoice_id, school_id, amount)
    values (pid, due.id, s.school_id, take);
    remaining := remaining - take;
  end loop;

  return query select pid, rno;
end
$function$;

CREATE OR REPLACE FUNCTION public.cancel_payment(payment uuid, p_device jsonb DEFAULT NULL::jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform set_config('godview.device', coalesce(p_device::text, ''), true);
  update public.fee_payments set status = 'cancelled'
   where id = payment and status = 'success' and public.can_wide(school_id, 'fees', 2);
  if not found then
    raise exception 'not allowed';
  end if;
end
$function$;

CREATE OR REPLACE FUNCTION public.generate_invoices(session uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  ses public.academic_sessions;
  start_year int;
  line record;
  enr record;
  plan public.fee_plans;
  months_due date[];
  due_on date[];
  k int;
  steps int;
  step_months int;
  m date;
  per text;
  lbl text;
  inserted int := 0;
  n int;
begin
  select * into ses from public.academic_sessions where id = session;
  if ses.id is null or not public.can_wide(ses.school_id, 'fees', 2) then
    raise exception 'not allowed';
  end if;
  start_year := coalesce(extract(year from ses.starts_on)::int, split_part(ses.name, '-', 1)::int);

  for line in
    select f.* from public.fee_schedule f where f.session_id = session
  loop
    months_due := '{}';
    due_on := '{}';
    if line.plan_id is not null then
      select * into plan from public.fee_plans where id = line.plan_id;
      for k in 1 .. cardinality(plan.months) loop
        months_due := months_due || make_date(start_year + case when plan.months[k] < 4 then 1 else 0 end, plan.months[k], 1);
        due_on := due_on || make_date(
          start_year + case when coalesce(plan.due_months[k], plan.months[k]) < 4 then 1 else 0 end,
          coalesce(plan.due_months[k], plan.months[k]), 1) + (plan.due_day - 1);
      end loop;
    else
      plan := null;
      steps := case line.frequency when 'monthly' then 12 when 'quarterly' then 4 when 'half_yearly' then 2 else 1 end;
      step_months := 12 / steps;
      for k in 0 .. steps - 1 loop
        m := (make_date(start_year + case when line.start_month < 4 then 1 else 0 end, line.start_month, 1)
          + make_interval(months => k * step_months))::date;
        months_due := months_due || m;
        due_on := due_on || (m + (line.due_day - 1));
      end loop;
    end if;

    for k in 1 .. cardinality(months_due) loop
      m := months_due[k];
      if line.plan_id is not null or line.frequency = 'monthly' then
        per := to_char(m, 'YYYY-MM');
        lbl := to_char(m, 'Mon YYYY');
      else
        per := case line.frequency
          when 'quarterly' then 'Q' || k
          when 'half_yearly' then 'H' || k
          when 'annual' then 'annual'
          else 'one-time'
        end;
        lbl := case line.frequency
          when 'quarterly' then 'Quarter ' || k
          when 'half_yearly' then 'Half-year ' || k
          when 'annual' then 'Annual'
          else 'One-time'
        end;
      end if;

      for enr in
        select e.student_id from public.student_enrolments e
        where e.session_id = session and e.status = 'active'
          and case when line.stop_id is not null then
            -- On the bus from this stop
            exists (
              select 1 from public.student_private p
              where p.student_id = e.student_id and p.uses_bus and p.bus_stop_id = line.stop_id
            )
          else
            public.fee_line_matches(line.class, line.streams, e.class, e.stream)
            and not exists (
              select 1 from public.fee_schedule o
              where o.session_id = session and o.head_id = line.head_id and o.id <> line.id and o.stop_id is null
                and public.fee_line_rank(o.class, o.streams) > public.fee_line_rank(line.class, line.streams)
                and public.fee_line_matches(o.class, o.streams, e.class, e.stream)
            )
          end
      loop
        insert into public.fee_invoices (school_id, session_id, student_id, head_id, period, label, amount, due_date)
        values (ses.school_id, session, enr.student_id, line.head_id, per, lbl, line.amount, due_on[k])
        on conflict (student_id, session_id, head_id, period) do nothing;
        get diagnostics n = row_count;
        inserted := inserted + n;
      end loop;
    end loop;
  end loop;
  return inserted;
end
$function$;

CREATE OR REPLACE FUNCTION public.session_fee_totals(session uuid)
 RETURNS TABLE(student_id uuid, billed numeric, paid numeric, balance numeric, due_now numeric, next_due_date date)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not exists (select 1 from public.academic_sessions a_ where a_.id = session and public.can_wide(a_.school_id, 'fees', 1)) then
    return;
  end if;
  return query
    with paid as (
      select fa.invoice_id, sum(fa.amount) as amount
      from public.fee_allocations fa
      join public.fee_payments p on p.id = fa.payment_id and p.status = 'success'
      join public.fee_invoices i on i.id = fa.invoice_id and i.session_id = session
      group by fa.invoice_id
    ),
    b as (
      select i.student_id, i.amount - i.concession as billed, coalesce(pd.amount, 0) as paid,
             i.amount - i.concession - coalesce(pd.amount, 0) as balance, i.due_date
      from public.fee_invoices i
      left join paid pd on pd.invoice_id = i.id
      where i.session_id = session
    )
    select b.student_id, sum(b.billed), sum(b.paid), sum(b.balance),
           sum(b.balance) filter (where b.due_date is null or b.due_date <= current_date),
           min(b.due_date) filter (where b.balance > 0)
    from b
    group by b.student_id;
end
$function$;

CREATE OR REPLACE FUNCTION public.fee_session_summary(session uuid)
 RETURNS TABLE(billed numeric, collected numeric, outstanding numeric, due_now numeric, students_due bigint)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
begin
  if exists (select 1 from public.academic_sessions a_ where a_.id = session and public.can_wide(a_.school_id, 'fees', 1)) then
    return query
      select coalesce(sum(t.billed), 0), coalesce(sum(t.paid), 0), coalesce(sum(t.balance), 0),
             coalesce(sum(t.due_now), 0), count(*) filter (where t.due_now > 0)
      from public.session_fee_totals(session) t;
  else
    return query
      select coalesce(sum(t.billed), 0), coalesce(sum(t.paid), 0), coalesce(sum(t.balance), 0),
             coalesce(sum(t.due_now), 0), count(*) filter (where t.due_now > 0)
      from public.fee_student_totals t
      where t.session_id = session;
  end if;
end
$function$;

CREATE OR REPLACE FUNCTION public.ai_fees_pack(p_school uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  sess uuid := public.current_session(p_school);
  d date := public.ist_today();
  out jsonb;
begin
  if not (coalesce(auth.role(), '') = 'service_role' or public.can_wide(p_school, 'fees', 1)) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if sess is null then
    return jsonb_build_object('error', 'no session');
  end if;

  with
  enrolled as (
    select e.student_id, e.class, coalesce(e.section, '') as section,
      public.class_text(e.class, e.section) as class_name, s.name
    from public.student_enrolments e
    join public.students s on s.id = e.student_id
    where e.session_id = sess and e.status <> 'left'
  ),
  inv as (
    select b.*, en.class, en.class_name, en.name
    from public.fee_invoice_balances b
    join enrolled en on en.student_id = b.student_id
    where b.session_id = sess
  ),
  pays as (
    select p.* from public.fee_payments p
    join enrolled en on en.student_id = p.student_id
    where p.school_id = p_school and p.status = 'success'
  ),
  -- Reminders reach a family when a parent has the app with notifications on
  reach as (
    select distinct gs.student_id
    from public.guardian_students gs
    join public.guardians g on g.id = gs.guardian_id
    join public.parent_devices() pd on pd.phone = g.phone
    where gs.school_id = p_school and not gs.removed
  ),
  -- The app's rule (feeFields() in personMapping.js): a student is
  -- overdue when their oldest unpaid due is more than 15 days old; what
  -- they owe is everything due by today ("Due now").
  dues as (
    select i.student_id, i.name, i.class_name,
      coalesce(sum(i.balance) filter (where (i.due_date is null or i.due_date <= d) and i.balance > 0.009), 0) as due_now,
      min(i.due_date) filter (where i.balance > 0.009) as oldest_due,
      sum(i.concession) as concession
    from inv i group by i.student_id, i.name, i.class_name
  ),
  per_student as (
    select dues.*,
      case when due_now > 0 and oldest_due < d - 15 then due_now else 0 end as overdue
    from dues
  ),
  late as (
    -- How late each payment was against the due date it paid off
    select greatest(0, p.paid_on - i.due_date) as days_late
    from public.fee_allocations fa
    join pays p on p.id = fa.payment_id
    join inv i on i.id = fa.invoice_id
    where i.due_date is not null
  )
  select jsonb_build_object(
    'today', d,
    'session', (select a.name from public.academic_sessions a where a.id = sess),
    'students', (select count(*) from enrolled),
    'totals', (
      select jsonb_build_object(
        'billed', round(coalesce(sum(i.amount - i.concession), 0)),
        'concession', round(coalesce(sum(i.concession), 0)),
        'collected', round(coalesce(sum(i.paid), 0)),
        'outstanding', round(coalesce(sum(i.balance), 0)),
        'due_so_far', round(coalesce(sum(i.amount - i.concession) filter (where i.due_date <= d), 0)),
        'collected_of_due_so_far', round(coalesce(sum(i.paid) filter (where i.due_date <= d), 0)),
        'due_now', (select round(sum(due_now)) from per_student),
        'students_due', (select count(*) from per_student where due_now > 0),
        'overdue', (select round(coalesce(sum(overdue), 0)) from per_student),
        'collection_rate_pct', round(100 * coalesce(sum(i.paid) filter (where i.due_date <= d), 0)
          / nullif(sum(i.amount - i.concession) filter (where i.due_date <= d), 0)),
        'students_overdue', (select count(*) from per_student where overdue > 0),
        'students_with_concession', (select count(*) from per_student where concession > 0)
      ) from inv i
    ),
    'by_month', (
      select coalesce(jsonb_agg(m order by m->>'month'), '[]'::jsonb) from (
        select jsonb_build_object(
          'month', to_char(mm, 'YYYY-MM'),
          'due', round(coalesce((select sum(i.amount - i.concession) from inv i where date_trunc('month', i.due_date) = mm), 0)),
          'collected', round(coalesce((select sum(p.amount) from pays p where date_trunc('month', p.paid_on) = mm), 0)),
          'payments', (select count(*) from pays p where date_trunc('month', p.paid_on) = mm)
        ) as m
        from generate_series(date_trunc('month', d) - interval '11 months', date_trunc('month', d), interval '1 month') mm
      ) x
    ),
    'by_class', (
      select coalesce(jsonb_agg(c order by c->>'class'), '[]'::jsonb) from (
        select jsonb_build_object(
          'class', i.class_name,
          'students', count(distinct i.student_id),
          'due_so_far', round(coalesce(sum(i.amount - i.concession) filter (where i.due_date <= d), 0)),
          'collected', round(coalesce(sum(i.paid), 0)),
          'overdue', (select round(coalesce(sum(ps.overdue), 0)) from per_student ps where ps.class_name = i.class_name),
          'students_overdue', (select count(*) from per_student ps where ps.class_name = i.class_name and ps.overdue > 0),
          'collection_rate_pct', round(100 * coalesce(sum(i.paid) filter (where i.due_date <= d), 0)
            / nullif(sum(i.amount - i.concession) filter (where i.due_date <= d), 0))
        ) as c
        from inv i group by i.class_name
      ) x
    ),
    'overdue_age', (
      select jsonb_agg(jsonb_build_object('days', b.label, 'amount', round(coalesce(t.amount, 0)), 'students', coalesce(t.students, 0)) order by b.lo)
      from (values (16, 30, '16-30'), (31, 60, '31-60'), (61, 90, '61-90'), (91, 100000, '90+')) b (lo, hi, label)
      left join lateral (
        select sum(ps.overdue) as amount, count(*) as students
        from per_student ps
        where ps.overdue > 0 and (d - ps.oldest_due) between b.lo and b.hi
      ) t on true
    ),
    'payment_timing', (
      select jsonb_build_object(
        'allocations', count(*),
        'paid_by_due_date_pct', round(100.0 * count(*) filter (where days_late = 0) / nullif(count(*), 0)),
        'average_days_late', round(avg(days_late)),
        'paid_over_30_days_late_pct', round(100.0 * count(*) filter (where days_late > 30) / nullif(count(*), 0))
      ) from late
    ),
    'methods', (
      select coalesce(jsonb_agg(jsonb_build_object('method', p.method, 'payments', p.n, 'amount', p.amount) order by p.amount desc), '[]'::jsonb)
      from (select method, count(*) as n, round(sum(amount)) as amount from pays group by method) p
    ),
    'fee_heads', (
      select coalesce(jsonb_agg(jsonb_build_object('head', h.name, 'billed', x.billed, 'collected', x.collected, 'overdue', x.overdue) order by x.billed desc), '[]'::jsonb)
      from (
        select i.head_id, round(sum(i.amount - i.concession)) as billed, round(sum(i.paid)) as collected,
          round(coalesce(sum(i.balance) filter (where i.due_date < d - 15 and i.balance > 0.009), 0)) as overdue
        from inv i group by i.head_id
      ) x join public.fee_heads h on h.id = x.head_id
    ),
    'reminders_reach', (
      select jsonb_build_object(
        'students_overdue_parent_has_app', count(*) filter (where r.student_id is not null),
        'students_overdue_parent_no_app', count(*) filter (where r.student_id is null),
        'overdue_amount_parent_no_app', round(coalesce(sum(ps.overdue) filter (where r.student_id is null), 0))
      )
      from per_student ps left join reach r on r.student_id = ps.student_id
      where ps.overdue > 0
    ),
    'top_overdue', (
      select coalesce(jsonb_agg(t order by (t->>'overdue')::numeric desc), '[]'::jsonb) from (
        select jsonb_build_object(
          'id', ps.student_id,
          'name', ps.name,
          'class', ps.class_name,
          'overdue', round(ps.overdue),
          'days_overdue', d - ps.oldest_due,
          'last_payment', (select max(p.paid_on) from pays p where p.student_id = ps.student_id),
          'parent_has_app', exists (select 1 from reach r where r.student_id = ps.student_id)
        ) as t
        from per_student ps
        where ps.overdue > 0
        order by ps.overdue desc
        limit 25
      ) x
    )
  ) into out;
  return out;
end
$function$;

CREATE OR REPLACE FUNCTION public.ai_results_pack(p_school uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  sess uuid := public.current_session(p_school);
  out jsonb;
begin
  if not (coalesce(auth.role(), '') = 'service_role' or public.can_wide(p_school, 'results', 1)) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if sess is null then
    return jsonb_build_object('error', 'no session');
  end if;

  with
  en as (
    select e.student_id, st.name, public.class_text(e.class, e.section) as class_name
    from public.student_enrolments e
    join public.students st on st.id = e.student_id
    where e.session_id = sess and e.status = 'active'
  ),
  r as (
    select er.student_id, er.exam, er.subject, er.created_at, en.name, en.class_name,
      100.0 * er.marks / er.max_marks as pct
    from public.exam_results er
    join en on en.student_id = er.student_id
    where er.session_id = sess and er.marks is not null and er.max_marks > 0
  ),
  exams as (
    select exam, row_number() over (order by min(created_at)) as n from r group by exam
  ),
  -- Each student's average in each exam, and overall
  se as (
    select r.student_id, r.name, r.class_name, x.n, r.exam, avg(r.pct) as pct
    from r join exams x on x.exam = r.exam
    group by r.student_id, r.name, r.class_name, x.n, r.exam
  ),
  st as (
    select student_id, name, class_name, avg(pct) as pct, count(*) as exams,
      (array_agg(pct order by n desc))[1] as last_pct,
      (array_agg(pct order by n desc))[2] as previous_pct,
      (array_agg(exam order by n desc))[1] as last_exam,
      (array_agg(exam order by n desc))[2] as previous_exam
    from se group by student_id, name, class_name
  ),
  subj as (
    select student_id, subject, avg(pct) as pct from r group by student_id, subject
  ),
  struggling as (
    select s.*, (select sb.subject from subj sb where sb.student_id = s.student_id order by sb.pct limit 1) as weakest,
      (select count(*) from subj sb where sb.student_id = s.student_id and sb.pct < 33) as below_33_subjects
    from st s order by s.pct limit 20
  ),
  dropped as (
    select * from st where previous_pct is not null and previous_pct - last_pct >= 10
    order by previous_pct - last_pct desc limit 15
  ),
  top as (
    select * from st order by pct desc limit 10
  )
  select jsonb_build_object(
    'session', (select a.name from public.academic_sessions a where a.id = sess),
    'students', (select count(*) from en),
    'students_with_marks', (select count(*) from st),
    'exams', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'exam', x.exam, 'order', x.n,
        'students_with_marks', (select count(distinct r.student_id) from r where r.exam = x.exam),
        'subjects', (select count(distinct r.subject) from r where r.exam = x.exam),
        'average_pct', (select round(avg(r.pct)) from r where r.exam = x.exam)
      ) order by x.n), '[]'::jsonb) from exams x
    ),
    'by_class_exam', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'class', c.class_name, 'exam', c.exam, 'average_pct', c.avg_pct,
        'students_with_marks', c.marked, 'class_size', c.size, 'students_below_33', c.below
      ) order by c.class_name, c.n), '[]'::jsonb)
      from (
        select se.class_name, se.exam, x.n, round(avg(se.pct)) as avg_pct, count(*) as marked,
          (select count(*) from en where en.class_name = se.class_name) as size,
          count(*) filter (where se.pct < 33) as below
        from se join exams x on x.exam = se.exam
        group by se.class_name, se.exam, x.n
      ) c
    ),
    'by_class_subject', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'class', c.class_name, 'subject', c.subject, 'average_pct', c.avg_pct, 'students_below_33', c.below
      ) order by c.class_name, c.avg_pct), '[]'::jsonb)
      from (
        select r.class_name, r.subject, round(avg(r.pct)) as avg_pct,
          count(distinct r.student_id) filter (where r.pct < 33) as below
        from r group by r.class_name, r.subject
      ) c
    ),
    'by_subject', (
      select coalesce(jsonb_agg(jsonb_build_object('subject', s.subject, 'average_pct', s.avg_pct, 'students_below_33', s.below) order by s.avg_pct), '[]'::jsonb)
      from (
        select subject, round(avg(pct)) as avg_pct, count(distinct student_id) filter (where pct < 33) as below
        from r group by subject
      ) s
    ),
    'struggling', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', s.student_id, 'name', s.name, 'class', s.class_name, 'average_pct', round(s.pct),
        'weakest_subject', s.weakest, 'subjects_below_33', s.below_33_subjects
      ) order by s.pct), '[]'::jsonb) from struggling s
    ),
    'dropped', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', s.student_id, 'name', s.name, 'class', s.class_name,
        'previous_exam', s.previous_exam, 'previous_pct', round(s.previous_pct),
        'last_exam', s.last_exam, 'last_pct', round(s.last_pct),
        'drop_points', round(s.previous_pct) - round(s.last_pct)
      ) order by s.previous_pct - s.last_pct desc), '[]'::jsonb) from dropped s
    ),
    'top', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', s.student_id, 'name', s.name, 'class', s.class_name, 'average_pct', round(s.pct)
      ) order by s.pct desc), '[]'::jsonb) from top s
    )
  ) into out;
  return out;
end
$function$;

CREATE OR REPLACE FUNCTION public.ai_staff_pack(p_school uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  sess uuid := public.current_session(p_school);
  d date := public.ist_today();
  out jsonb;
begin
  if not (coalesce(auth.role(), '') = 'service_role' or public.can_wide(p_school, 'staff', 1)) then
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
$function$;

CREATE OR REPLACE FUNCTION public.ai_transport_pack(p_school uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  sess uuid := public.current_session(p_school);
  d date := public.ist_today();
  home record;
  out jsonb;
begin
  if not (coalesce(auth.role(), '') = 'service_role' or public.can_wide(p_school, 'transport', 1)) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if sess is null then
    return jsonb_build_object('error', 'no session');
  end if;
  select s.lat, s.lng into home from public.schools s where s.id = p_school;

  with
  sp as (
    select e.student_id, st.name, public.class_text(e.class, e.section) as class_name,
      coalesce(p.uses_bus, false) as uses_bus, p.bus_stop_id, p.area_id, p.home_lat,
      public.area_key(public.place_text(p.address, p.pickup_point, p.city)) as key
    from public.student_enrolments e
    join public.students st on st.id = e.student_id
    left join public.student_private p on p.student_id = e.student_id
    where e.session_id = sess and e.status = 'active'
  ),
  alias as (
    select distinct on (k) a.id, k
    from public.school_areas a
    cross join lateral unnest(array_append(a.aliases, public.area_key(a.name))) as k
    where a.school_id = p_school and k <> ''
    order by k, a.name desc -- like the app: the last village by name wins
  ),
  placed as (
    select sp.*, coalesce(a1.id, al.id) as village_id
    from sp
    left join public.school_areas a1 on a1.id = sp.area_id and a1.school_id = p_school
    left join alias al on al.k = sp.key and sp.key <> ''
  ),
  stops as (
    select b.id, b.name, b.route_id, b.sort, b.pickup_at, b.lat, b.lng, r.name as route, al.id as village_id
    from public.bus_stops b
    join public.bus_routes r on r.id = b.route_id
    left join alias al on al.k = public.area_key(b.name)
    where b.school_id = p_school
  ),
  riders as (
    select bus_stop_id, count(*) as n from placed where uses_bus and bus_stop_id is not null group by bus_stop_id
  ),
  villages as (
    select a.id, a.name, a.lat, a.lng,
      count(pl.student_id) as students,
      count(pl.student_id) filter (where pl.uses_bus) as on_bus
    from public.school_areas a
    left join placed pl on pl.village_id = a.id
    where a.school_id = p_school
    group by a.id
  )
  select jsonb_build_object(
    'today', d,
    'school_location_set', home.lat is not null,
    'totals', (
      select jsonb_build_object(
        'students', count(*),
        'on_bus', count(*) filter (where uses_bus),
        'on_bus_without_stop', count(*) filter (where uses_bus and (bus_stop_id is null or not exists (select 1 from stops s where s.id = placed.bus_stop_id))),
        'homes_pinned', count(*) filter (where home_lat is not null),
        'in_a_known_village', count(*) filter (where village_id is not null),
        'village_unknown', count(*) filter (where village_id is null),
        'routes', (select count(*) from public.bus_routes r where r.school_id = p_school),
        'buses', (select count(*) from public.buses b where b.school_id = p_school and b.status <> 'retired')
      ) from placed
    ),
    'villages', (
      select coalesce(jsonb_agg(v order by (v->>'students')::int desc), '[]'::jsonb) from (
        select jsonb_build_object(
          'village', vi.name,
          'students', vi.students,
          'on_bus', vi.on_bus,
          'not_on_bus', vi.students - vi.on_bus,
          'km_from_school', public.km_between(home.lat, home.lng, vi.lat, vi.lng),
          'stop_on_routes', coalesce((select jsonb_agg(distinct s.route) from stops s where s.village_id = vi.id), '[]'::jsonb)
        ) as v
        from villages vi
        where vi.students > 0
        order by vi.students desc
        limit 40
      ) x
    ),
    'routes', (
      select coalesce(jsonb_agg(rt order by rt->>'route'), '[]'::jsonb) from (
        select jsonb_build_object(
          'route', r.name,
          'bus', b.number,
          'bus_status', b.status,
          'seats', b.seats,
          'riders', coalesce((select sum(rd.n) from stops s join riders rd on rd.bus_stop_id = s.id where s.route_id = r.id), 0),
          'morning_start', to_char(r.morning_at, 'HH24:MI'),
          'leaves_school', to_char(r.evening_at, 'HH24:MI'),
          'stops', coalesce((
            select jsonb_agg(jsonb_build_object(
              'stop', s.name,
              'pickup', to_char(s.pickup_at, 'HH24:MI'),
              'riders', coalesce(rd.n, 0),
              'km_from_school', public.km_between(home.lat, home.lng, s.lat, s.lng)
            ) order by s.sort)
            from stops s left join riders rd on rd.bus_stop_id = s.id
            where s.route_id = r.id
          ), '[]'::jsonb)
        ) as rt
        from public.bus_routes r
        left join public.buses b on b.id = r.bus_id
        where r.school_id = p_school
      ) x
    ),
    'buses', (
      select coalesce(jsonb_agg(bj), '[]'::jsonb) from (
        select jsonb_build_object(
          'bus', b.number,
          'name', b.name,
          'seats', b.seats,
          'status', b.status,
          'routes', (select count(*) from public.bus_routes r where r.bus_id = b.id),
          'driver_added', b.driver_name is not null,
          'conductor_added', b.conductor_name is not null,
          'safety_missing', (
            select coalesce(jsonb_agg(x), '[]'::jsonb) from unnest(array[
              case when not b.has_gps then 'GPS' end,
              case when not b.has_cctv then 'CCTV' end,
              case when not b.has_speed_governor then 'speed governor' end,
              case when not b.has_first_aid then 'first aid box' end
            ]) as x where x is not null
          ),
          -- Papers run out or running out within 60 days (negative: ran out)
          'papers_due', (
            select coalesce(jsonb_agg(jsonb_build_object('paper', p.label, 'days_left', p.until - d) order by p.until), '[]'::jsonb)
            from (values
              ('insurance', b.insurance_until), ('fitness', b.fitness_until), ('pollution (PUC)', b.puc_until),
              ('permit', b.permit_until), ('road tax', b.tax_until), ('fire extinguisher', b.extinguisher_until),
              ('driver''s licence', b.licence_until)
            ) as p (label, until)
            where p.until is not null and p.until - d <= 60
          ),
          'papers_not_added', (
            select count(*) from unnest(array[b.insurance_until, b.fitness_until, b.puc_until, b.permit_until, b.tax_until]) as u where u is null
          )
        ) as bj
        from public.buses b
        where b.school_id = p_school and b.status <> 'retired'
      ) x
    )
  ) into out;
  return out;
end
$function$;

CREATE OR REPLACE FUNCTION public.register_admission(p_id uuid, p_fee numeric, p_method text, p_reference text, p_paid_on date)
 RETURNS admissions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  a public.admissions;
  n bigint;
  amount numeric := coalesce(p_fee, 0);
begin
  select * into a from public.admissions where id = p_id for update;
  if a.id is null or not public.can_wide(a.school_id, 'admissions', 2) then
    raise exception 'not allowed';
  end if;
  if a.stage <> 'enquiry' then
    raise exception 'already registered';
  end if;
  if amount < 0 or (amount > 0 and p_method is null) then
    raise exception 'a fee needs a payment mode';
  end if;

  insert into public.school_counters (school_id, name, value) values (a.school_id, 'registration', 1)
  on conflict (school_id, name) do update set value = public.school_counters.value + 1
  returning value into n;

  update public.admissions
     set stage = 'registered',
         registration_no = 'REG-' || lpad(n::text, 6, '0'),
         registered_on = current_date,
         follow_up = null,
         fee = nullif(amount, 0),
         fee_method = case when amount > 0 then p_method end,
         fee_reference = case when amount > 0 then nullif(trim(p_reference), '') end,
         fee_paid_on = case when amount > 0 then coalesce(p_paid_on, current_date) end,
         fee_receipt_no = case when amount > 0 then public.next_receipt_no(a.school_id) end,
         fee_mode = case when amount > 0 then (select s.admission_fee_mode from public.schools s where s.id = a.school_id) end
   where id = p_id
  returning * into a;
  return a;
end
$function$;

CREATE OR REPLACE FUNCTION public.finish_admission(p_id uuid)
 RETURNS admissions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  a public.admissions;
  pid uuid;
  remaining numeric;
  due record;
  take numeric;
begin
  select * into a from public.admissions where id = p_id for update;
  if a.id is null or not public.can_wide(a.school_id, 'admissions', 2) then
    raise exception 'not allowed';
  end if;
  if a.stage <> 'registered' then
    raise exception 'not registered';
  end if;
  if not exists (select 1 from public.students s where s.id = p_id and s.school_id = a.school_id) then
    raise exception 'student missing';
  end if;

  if a.fee_mode = 'adjust' and a.fee > 0 then
    insert into public.fee_payments (school_id, student_id, amount, method, reference, paid_on, receipt_no, received_by, note, admission_id)
    values (a.school_id, p_id, a.fee, a.fee_method, a.fee_reference, a.fee_paid_on, a.fee_receipt_no,
            public.current_email(), 'Registration fee ' || a.registration_no, a.id)
    returning id into pid;

    remaining := a.fee;
    for due in
      select b.id, b.balance
      from public.fee_invoice_balances b
      where b.student_id = p_id and b.balance > 0
      order by b.due_date nulls first, b.created_at
    loop
      exit when remaining <= 0;
      take := least(remaining, due.balance);
      insert into public.fee_allocations (payment_id, invoice_id, school_id, amount)
      values (pid, due.id, a.school_id, take);
      remaining := remaining - take;
    end loop;
  end if;

  update public.admissions
     set stage = 'admitted', admitted_on = current_date, follow_up = null
   where id = p_id
  returning * into a;
  return a;
end
$function$;

CREATE OR REPLACE FUNCTION public.set_admission_settings(p_school uuid, p_mode text, p_fee numeric, p_test boolean)
 RETURNS schools
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  saved public.schools;
begin
  if not public.can_wide(p_school, 'admissions', 2) then
    raise exception 'not allowed';
  end if;
  update public.schools
     set admission_fee_mode = p_mode, admission_fee = p_fee, admission_test = coalesce(p_test, false)
   where id = p_school
  returning * into saved;
  return saved;
end
$function$;

CREATE OR REPLACE FUNCTION public.set_grade_seats(p_school uuid, p_seats jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not public.can_wide(p_school, 'admissions', 2) then
    raise exception 'not allowed';
  end if;
  update public.school_grades g
     set seats = nullif(p_seats ->> g.code, '')::int
   where g.school_id = p_school and p_seats ? g.code;
end
$function$;

CREATE OR REPLACE FUNCTION public.issue_certificate(p_student uuid, p_kind text, p_details jsonb, p_issued_on date)
 RETURNS student_certificates
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  s public.students;
  n bigint;
  prefix text;
  saved public.student_certificates;
begin
  select * into s from public.students where id = p_student;
  if s.id is null or not public.can_wide(s.school_id, 'certificates', 2) then
    raise exception 'not allowed';
  end if;
  prefix := case p_kind
    when 'bonafide' then 'BF'
    when 'slc' then 'SLC'
    when 'no_dues' then 'ND'
    when 'character' then 'CC'
    when 'fee_paid' then 'FP'
    when 'dob' then 'DOB'
  end;
  if prefix is null then
    raise exception 'unknown certificate';
  end if;
  if p_issued_on is null or p_issued_on > current_date then
    raise exception 'issue date can''t be in the future';
  end if;
  if p_kind = 'no_dues' and exists (
    select 1 from public.fee_invoice_balances b
    where b.student_id = p_student and b.balance > 0 and coalesce(b.due_date, current_date) <= current_date
  ) then
    raise exception 'dues pending';
  end if;

  insert into public.school_counters (school_id, name, value) values (s.school_id, 'cert_' || p_kind, 1)
  on conflict (school_id, name) do update set value = public.school_counters.value + 1
  returning value into n;

  insert into public.student_certificates (school_id, student_id, kind, serial_no, is_duplicate, details, issued_on, issued_by)
  values (
    s.school_id, p_student, p_kind, prefix || '-' || lpad(n::text, 6, '0'),
    p_kind = 'slc' and exists (
      select 1 from public.student_certificates c
      where c.student_id = p_student and c.kind = 'slc' and c.cancelled_at is null
    ),
    p_details, p_issued_on, public.current_email()
  )
  returning * into saved;
  return saved;
end
$function$;

CREATE OR REPLACE FUNCTION public.cancel_certificate(p_id uuid, p_reason text)
 RETURNS student_certificates
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  saved public.student_certificates;
begin
  update public.student_certificates
     set cancelled_at = now(), cancelled_by = public.current_email(), cancel_reason = nullif(trim(p_reason), '')
   where id = p_id and cancelled_at is null and public.can_wide(school_id, 'certificates', 2)
  returning * into saved;
  if saved.id is null then
    raise exception 'not allowed';
  end if;
  return saved;
end
$function$;

CREATE OR REPLACE FUNCTION public.add_guardian(p_student uuid, p_phone text, p_name text, p_relation text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  s public.students;
  normalised text := public.normalise_phone(p_phone);
  gid uuid;
begin
  select * into s from public.students where id = p_student;
  if s.id is null or not public.can_wide(s.school_id, 'students', 2) then
    raise exception 'not allowed';
  end if;
  if normalised is null then
    raise exception 'enter a 10-digit Indian mobile number';
  end if;
  insert into public.guardians (school_id, phone, name)
  values (s.school_id, normalised, nullif(trim(p_name), ''))
  on conflict (school_id, phone) do update set name = coalesce(excluded.name, public.guardians.name)
  returning id into gid;
  insert into public.guardian_students (guardian_id, student_id, school_id, relation, source)
  values (gid, p_student, s.school_id, coalesce(p_relation, 'guardian'), 'manual')
  on conflict (guardian_id, student_id) do update set removed = false, relation = excluded.relation, source = 'manual';
  return gid;
end
$function$;

CREATE OR REPLACE FUNCTION public.can_see_request_document(object_name text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (
    select 1
    from public.access_requests r
    join auth.users u on lower(u.email) = r.email
    where object_name like 'requests/' || u.id::text || '/%'
      and public.can_wide(r.school_id, 'staff', 1)
      and public.is_school_admin(r.school_id)
  )
$function$;

CREATE OR REPLACE FUNCTION public.can_see_request_photo(object_name text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (
    select 1
    from public.access_requests r
    join auth.users u on lower(u.email) = r.email
    where object_name = 'requests/' || u.id::text || '.jpg'
      and public.can_wide(r.school_id, 'staff', 1)
      and public.is_school_admin(r.school_id)
  )
$function$;

CREATE OR REPLACE FUNCTION public.attendance_overview(session uuid, p_day date)
 RETURNS TABLE(class text, section text, students bigint, present bigint, absent bigint, late bigint, on_leave bigint, unmarked bigint, marked_by text, class_teacher text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not (exists (select 1 from public.academic_sessions a_ where a_.id = session and public.can_wide(a_.school_id, 'attendance', 1))) then
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
      where e.session_id = session and e.status = 'active'
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
$function$;

CREATE OR REPLACE FUNCTION public.can_mark_attendance(student uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (
    select 1 from public.students s where s.id = student and public.can_wide(s.school_id, 'attendance', 2)
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
      and public.can(t.school_id, 'attendance', 2)
  )
$function$;

CREATE OR REPLACE FUNCTION public.session_students(session uuid)
 RETURNS SETOF jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
      'student', to_jsonb(s) || jsonb_build_object('private', case when s.school_id in (select public.schools_wide('students', 1)) then to_jsonb(p) end)
    )
    from public.student_enrolments e
    join public.students s on s.id = e.student_id
    left join public.student_private p on p.student_id = s.id
    where e.session_id = session
    order by e.student_id;
end
$function$;

