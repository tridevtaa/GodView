-- Phase 1 for the parent app: parents, requests, shared notes and fees.
--
-- Parents sign in with their mobile number (phone OTP). They are linked to
-- children through the phone numbers on each student's record; staff can add
-- or remove links. A parent sees only their own children: profile, class,
-- results, shared notes, fees and their requests.
--
-- GodView becomes the school's fee system: fee heads, a fee schedule per
-- session and class, dues (invoices) generated from it, payments with
-- receipts, and allocation of each payment to the oldest dues first.

-- ---------------------------------------------------------------- phones ---

-- Indian mobile numbers to +91XXXXXXXXXX; anything else (landlines,
-- placeholders like 1234567891) becomes null.
create function public.normalise_phone(p text) returns text
language plpgsql immutable set search_path = '' as $$
declare
  d text := regexp_replace(coalesce(p, ''), '\D', '', 'g');
begin
  if length(d) = 12 and left(d, 2) = '91' then
    d := substr(d, 3);
  elsif length(d) = 11 and left(d, 1) = '0' then
    d := substr(d, 2);
  end if;
  if d ~ '^[6-9]\d{9}$' then
    return '+91' || d;
  end if;
  return null;
end
$$;

-- The caller's verified mobile number (from phone sign-in), normalised.
create function public.current_phone() returns text
language sql stable security definer set search_path = '' as $$
  select public.normalise_phone(u.phone)
  from auth.users u
  where u.id = auth.uid() and u.phone_confirmed_at is not null
$$;

-- ------------------------------------------------------------- guardians ---

create table public.guardians (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  phone text not null check (phone ~ '^\+91[6-9]\d{9}$'),
  name text check (length(name) <= 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by text,
  unique (school_id, phone),
  unique (id, school_id)
);

create trigger guardians_touch before insert or update on public.guardians
  for each row execute function public.touch();

create table public.guardian_students (
  guardian_id uuid not null,
  student_id uuid not null,
  school_id uuid not null references public.schools (id) on delete cascade,
  relation text not null default 'guardian' check (relation in ('father', 'mother', 'guardian')),
  source text not null default 'auto' check (source in ('auto', 'manual')),
  -- Staff removed this link; automatic linking won't add it back.
  removed boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (guardian_id, student_id),
  foreign key (guardian_id, school_id) references public.guardians (id, school_id) on delete cascade,
  foreign key (student_id, school_id) references public.students (id, school_id) on delete cascade
);

create index guardian_students_student on public.guardian_students (student_id);

create function public.is_parent_of(student uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.guardian_students gs
    join public.guardians g on g.id = gs.guardian_id
    where gs.student_id = student and not gs.removed and g.phone = public.current_phone()
  )
$$;

create function public.is_parent_in_school(school uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.guardian_students gs
    join public.guardians g on g.id = gs.guardian_id
    where gs.school_id = school and not gs.removed and g.phone = public.current_phone()
  )
$$;

-- Links a student to guardians for the father, mother and parent phone on
-- record. Never re-adds a link staff removed; never changes manual links.
create function public.link_guardians_for(student uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  p public.student_private;
  s public.students;
  entry record;
  gid uuid;
begin
  select * into p from public.student_private where student_id = student;
  select * into s from public.students where id = student;
  if p.student_id is null or s.id is null then
    return;
  end if;
  for entry in
    select * from (values
      (public.normalise_phone(p.father_phone), 'father', s.father_name, 1),
      (public.normalise_phone(p.mother_phone), 'mother', s.mother_name, 2),
      (public.normalise_phone(p.parent_phone), 'guardian', s.father_name, 3)
    ) v(phone, relation, name, ord)
    where phone is not null
    order by ord
  loop
    insert into public.guardians (school_id, phone, name)
    values (s.school_id, entry.phone, entry.name)
    on conflict (school_id, phone) do update set name = coalesce(public.guardians.name, excluded.name)
    returning id into gid;

    insert into public.guardian_students (guardian_id, student_id, school_id, relation, source)
    values (gid, student, s.school_id, entry.relation, 'auto')
    on conflict (guardian_id, student_id) do nothing;
  end loop;
end
$$;

create function public.student_private_link_guardians() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform public.link_guardians_for(new.student_id);
  return new;
end
$$;

create trigger student_private_link_guardians
  after insert or update of parent_phone, father_phone, mother_phone on public.student_private
  for each row execute function public.student_private_link_guardians();

-- Staff add a parent by phone (manual link), e.g. a grandparent or a new number.
create function public.add_guardian(p_student uuid, p_phone text, p_name text, p_relation text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  s public.students;
  normalised text := public.normalise_phone(p_phone);
  gid uuid;
begin
  select * into s from public.students where id = p_student;
  if s.id is null or not public.is_school_admin(s.school_id) then
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
$$;

-- ---------------------------------------------------------- shared notes ---

alter table public.student_notes add column shared_with_parents boolean not null default false;

-- --------------------------------------------------------------- requests ---

create table public.parent_requests (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  student_id uuid not null,
  guardian_id uuid references public.guardians (id) on delete set null,
  kind text not null check (kind in ('leave', 'certificate', 'message')),
  subject text not null check (length(trim(subject)) between 1 and 150),
  body text check (length(body) <= 2000),
  leave_from date,
  leave_to date,
  certificate_type text check (length(certificate_type) <= 80),
  status text not null default 'open'
    check (status in ('open', 'approved', 'rejected', 'resolved', 'cancelled')),
  response text check (length(response) <= 2000),
  handled_by text,
  handled_at timestamptz,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by text,
  check (kind <> 'leave' or (leave_from is not null and leave_to is not null and leave_to >= leave_from)),
  foreign key (student_id, school_id) references public.students (id, school_id) on delete cascade
);

create index parent_requests_school_status on public.parent_requests (school_id, status, created_at desc);

create trigger parent_requests_touch before insert or update on public.parent_requests
  for each row execute function public.touch();

-- Parents create requests for their own child.
create function public.create_request(
  p_student uuid,
  p_kind text,
  p_subject text,
  p_body text,
  p_leave_from date,
  p_leave_to date,
  p_certificate_type text
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  s public.students;
  gid uuid;
  rid uuid;
begin
  select * into s from public.students where id = p_student;
  if s.id is null or not public.is_parent_of(p_student) then
    raise exception 'not allowed';
  end if;
  select g.id into gid from public.guardians g
  where g.school_id = s.school_id and g.phone = public.current_phone();
  insert into public.parent_requests
    (school_id, student_id, guardian_id, kind, subject, body, leave_from, leave_to, certificate_type, created_by)
  values
    (s.school_id, p_student, gid, p_kind, trim(p_subject), p_body, p_leave_from, p_leave_to, p_certificate_type, public.current_phone())
  returning id into rid;
  return rid;
end
$$;

-- Parents can withdraw their own request while it's still open.
create function public.cancel_request(request uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.parent_requests
     set status = 'cancelled'
   where id = request and status = 'open' and public.is_parent_of(student_id);
  if not found then
    raise exception 'not allowed';
  end if;
end
$$;

-- ------------------------------------------------------------------- fees ---

create table public.fee_heads (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 60),
  sort int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (school_id, name),
  unique (id, school_id)
);

-- What each class pays in a session: amount per head and how often.
create table public.fee_schedule (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  session_id uuid not null,
  class text, -- null = every class
  head_id uuid not null,
  amount numeric(12, 2) not null check (amount > 0),
  frequency text not null check (frequency in ('monthly', 'quarterly', 'half_yearly', 'annual', 'one_time')),
  start_month int not null default 4 check (start_month between 1 and 12),
  due_day int not null default 10 check (due_day between 1 and 28),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by text,
  foreign key (session_id, school_id) references public.academic_sessions (id, school_id) on delete cascade,
  foreign key (head_id, school_id) references public.fee_heads (id, school_id) on delete cascade
);

create unique index fee_schedule_unique on public.fee_schedule (session_id, coalesce(class, ''), head_id);

create trigger fee_schedule_touch before insert or update on public.fee_schedule
  for each row execute function public.touch();

-- A due: one head for one period (e.g. Tuition, April 2026) for one student.
create table public.fee_invoices (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  session_id uuid not null,
  student_id uuid not null,
  head_id uuid not null,
  period text not null check (length(period) between 1 and 20), -- 2026-04, 2026-Q1, annual, opening
  label text not null check (length(label) between 1 and 60), -- "Apr 2026"
  amount numeric(12, 2) not null check (amount >= 0),
  concession numeric(12, 2) not null default 0 check (concession >= 0),
  due_date date,
  note text check (length(note) <= 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by text,
  check (concession <= amount),
  unique (student_id, session_id, head_id, period),
  unique (id, school_id),
  foreign key (session_id, school_id) references public.academic_sessions (id, school_id) on delete cascade,
  foreign key (student_id, school_id) references public.students (id, school_id) on delete cascade,
  foreign key (head_id, school_id) references public.fee_heads (id, school_id) on delete restrict
);

create index fee_invoices_student on public.fee_invoices (student_id, session_id);
create index fee_invoices_session on public.fee_invoices (session_id, due_date);

create trigger fee_invoices_touch before insert or update on public.fee_invoices
  for each row execute function public.touch();

create table public.fee_payments (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  student_id uuid not null,
  amount numeric(12, 2) not null check (amount > 0),
  method text not null check (method in ('cash', 'cheque', 'upi', 'card', 'netbanking', 'bank_transfer', 'online')),
  reference text check (length(reference) <= 80),
  paid_on date not null default current_date,
  receipt_no text not null,
  status text not null default 'success' check (status in ('success', 'pending', 'failed', 'cancelled')),
  gateway text,
  gateway_order_id text,
  gateway_payment_id text unique,
  received_by text,
  note text check (length(note) <= 300),
  created_at timestamptz not null default now(),
  unique (school_id, receipt_no),
  unique (id, school_id),
  foreign key (student_id, school_id) references public.students (id, school_id) on delete restrict
);

create index fee_payments_student on public.fee_payments (student_id, paid_on desc);

create table public.fee_allocations (
  payment_id uuid not null,
  invoice_id uuid not null,
  school_id uuid not null references public.schools (id) on delete cascade,
  amount numeric(12, 2) not null check (amount > 0),
  primary key (payment_id, invoice_id),
  foreign key (payment_id, school_id) references public.fee_payments (id, school_id) on delete cascade,
  foreign key (invoice_id, school_id) references public.fee_invoices (id, school_id) on delete restrict
);

create index fee_allocations_invoice on public.fee_allocations (invoice_id);

create table public.school_counters (
  school_id uuid not null references public.schools (id) on delete cascade,
  name text not null,
  value bigint not null default 0,
  primary key (school_id, name)
);

-- Balance per due, from successful payments allocated to it. Runs with the
-- caller's permissions so RLS applies.
create view public.fee_invoice_balances with (security_invoker = true) as
select
  i.*,
  coalesce(a.paid, 0) as paid,
  i.amount - i.concession - coalesce(a.paid, 0) as balance
from public.fee_invoices i
left join lateral (
  select sum(fa.amount) as paid
  from public.fee_allocations fa
  join public.fee_payments p on p.id = fa.payment_id and p.status = 'success'
  where fa.invoice_id = i.id
) a on true;

-- Per student per session: billed, paid, balance and what's due by today.
create view public.fee_student_totals with (security_invoker = true) as
select
  b.school_id,
  b.session_id,
  b.student_id,
  sum(b.amount - b.concession) as billed,
  sum(b.paid) as paid,
  sum(b.balance) as balance,
  sum(b.balance) filter (where b.due_date is null or b.due_date <= current_date) as due_now,
  min(b.due_date) filter (where b.balance > 0) as next_due_date
from public.fee_invoice_balances b
group by b.school_id, b.session_id, b.student_id;

-- Next receipt number for a school, e.g. R-000124.
create function public.next_receipt_no(school uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare
  n bigint;
begin
  insert into public.school_counters (school_id, name, value) values (school, 'receipt', 1)
  on conflict (school_id, name) do update set value = public.school_counters.value + 1
  returning value into n;
  return 'R-' || lpad(n::text, 6, '0');
end
$$;

-- Office records a payment (cash, cheque, UPI…); it's applied to the
-- student's oldest outstanding dues first. Any excess stays as credit.
create function public.record_payment(
  p_student uuid,
  p_amount numeric,
  p_method text,
  p_reference text,
  p_paid_on date,
  p_note text
) returns table (payment_id uuid, receipt_no text)
language plpgsql security definer set search_path = '' as $$
declare
  s public.students;
  pid uuid;
  rno text;
  remaining numeric := p_amount;
  due record;
  take numeric;
begin
  select * into s from public.students where id = p_student;
  if s.id is null or not public.is_school_admin(s.school_id) then
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
$$;

-- Cancels a recorded payment (wrong entry, bounced cheque); its amount goes
-- back onto the dues it paid.
create function public.cancel_payment(payment uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.fee_payments set status = 'cancelled'
   where id = payment and status = 'success' and public.is_school_admin(school_id);
  if not found then
    raise exception 'not allowed';
  end if;
end
$$;

-- Creates the dues for a session from its fee schedule for every student
-- enrolled (and not left). Safe to run again: existing dues are kept.
create function public.generate_invoices(session uuid) returns int
language plpgsql security definer set search_path = '' as $$
declare
  ses public.academic_sessions;
  start_year int;
  line record;
  enr record;
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
  if ses.id is null or not public.is_school_admin(ses.school_id) then
    raise exception 'not allowed';
  end if;
  start_year := coalesce(extract(year from ses.starts_on)::int, split_part(ses.name, '-', 1)::int);

  for line in
    select f.*, h.name as head_name from public.fee_schedule f
    join public.fee_heads h on h.id = f.head_id
    where f.session_id = session
  loop
    steps := case line.frequency when 'monthly' then 12 when 'quarterly' then 4 when 'half_yearly' then 2 else 1 end;
    step_months := 12 / steps;
    for k in 0 .. steps - 1 loop
      -- Months from April run into the next calendar year (Apr 2026 … Mar 2027).
      m := make_date(start_year + case when line.start_month < 4 then 1 else 0 end, line.start_month, 1)
           + make_interval(months => k * step_months);
      per := case line.frequency
        when 'monthly' then to_char(m, 'YYYY-MM')
        when 'quarterly' then 'Q' || (k + 1)
        when 'half_yearly' then 'H' || (k + 1)
        when 'annual' then 'annual'
        else 'one-time'
      end;
      lbl := case line.frequency
        when 'monthly' then to_char(m, 'Mon YYYY')
        when 'quarterly' then 'Quarter ' || (k + 1)
        when 'half_yearly' then 'Half-year ' || (k + 1)
        when 'annual' then 'Annual'
        else 'One-time'
      end;
      for enr in
        select e.student_id from public.student_enrolments e
        where e.session_id = session and e.status <> 'left'
          and (line.class is null or e.class = line.class)
      loop
        insert into public.fee_invoices (school_id, session_id, student_id, head_id, period, label, amount, due_date)
        values (ses.school_id, session, enr.student_id, line.head_id, per, lbl, line.amount,
                m + (line.due_day - 1))
        on conflict (student_id, session_id, head_id, period) do nothing;
        get diagnostics n = row_count;
        inserted := inserted + n;
      end loop;
    end loop;
  end loop;
  return inserted;
end
$$;

-- School-wide figures for a session (owner/admin): billed, collected,
-- outstanding, due by today and students with something due.
create function public.fee_session_summary(session uuid)
returns table (billed numeric, collected numeric, outstanding numeric, due_now numeric, students_due bigint)
language sql stable security invoker set search_path = '' as $$
  select
    coalesce(sum(t.billed), 0),
    coalesce(sum(t.paid), 0),
    coalesce(sum(t.balance), 0),
    coalesce(sum(t.due_now), 0),
    count(*) filter (where t.due_now > 0)
  from public.fee_student_totals t
  where t.session_id = session
$$;

-- --------------------------------------------------------------- grants ---

revoke execute on function public.current_phone() from public, anon;
revoke execute on function public.is_parent_of(uuid) from public, anon;
revoke execute on function public.is_parent_in_school(uuid) from public, anon;
revoke execute on function public.link_guardians_for(uuid) from public, anon, authenticated;
revoke execute on function public.student_private_link_guardians() from public, anon, authenticated;
revoke execute on function public.add_guardian(uuid, text, text, text) from public, anon;
revoke execute on function public.create_request(uuid, text, text, text, date, date, text) from public, anon;
revoke execute on function public.cancel_request(uuid) from public, anon;
revoke execute on function public.next_receipt_no(uuid) from public, anon, authenticated;
revoke execute on function public.record_payment(uuid, numeric, text, text, date, text) from public, anon;
revoke execute on function public.cancel_payment(uuid) from public, anon;
revoke execute on function public.generate_invoices(uuid) from public, anon;
revoke execute on function public.fee_session_summary(uuid) from public, anon;
grant execute on function public.current_phone() to authenticated;
grant execute on function public.is_parent_of(uuid) to authenticated;
grant execute on function public.is_parent_in_school(uuid) to authenticated;
grant execute on function public.add_guardian(uuid, text, text, text) to authenticated;
grant execute on function public.create_request(uuid, text, text, text, date, date, text) to authenticated;
grant execute on function public.cancel_request(uuid) to authenticated;
grant execute on function public.record_payment(uuid, numeric, text, text, date, text) to authenticated;
grant execute on function public.cancel_payment(uuid) to authenticated;
grant execute on function public.generate_invoices(uuid) to authenticated;
grant execute on function public.fee_session_summary(uuid) to authenticated;

grant select, update, delete on public.guardians to authenticated;
grant select, update, delete on public.guardian_students to authenticated;
grant select, insert, update on public.parent_requests to authenticated;
grant select, insert, update, delete on public.fee_heads to authenticated;
grant select, insert, update, delete on public.fee_schedule to authenticated;
grant select, insert, update, delete on public.fee_invoices to authenticated;
grant select on public.fee_payments to authenticated;
grant select on public.fee_allocations to authenticated;
grant select on public.fee_invoice_balances to authenticated;
grant select on public.fee_student_totals to authenticated;

-- ------------------------------------------------------------- policies ---

alter table public.guardians enable row level security;
alter table public.guardian_students enable row level security;
alter table public.parent_requests enable row level security;
alter table public.fee_heads enable row level security;
alter table public.fee_schedule enable row level security;
alter table public.fee_invoices enable row level security;
alter table public.fee_payments enable row level security;
alter table public.fee_allocations enable row level security;
alter table public.school_counters enable row level security;

-- Guardians and links: owners/admins manage; parents see their own.
create policy "admins manage guardians" on public.guardians
  for all to authenticated using (public.is_school_admin(school_id)) with check (public.is_school_admin(school_id));
create policy "parents see themselves" on public.guardians
  for select to authenticated using (phone = public.current_phone());

create policy "admins manage guardian links" on public.guardian_students
  for all to authenticated using (public.is_school_admin(school_id)) with check (public.is_school_admin(school_id));
create policy "parents see their links" on public.guardian_students
  for select to authenticated
  using (not removed and exists (
    select 1 from public.guardians g where g.id = guardian_id and g.phone = public.current_phone()
  ));

-- What parents can read about their own children.
create policy "parents read their school" on public.schools
  for select to authenticated using (public.is_parent_in_school(id));
create policy "parents read sessions" on public.academic_sessions
  for select to authenticated using (public.is_parent_in_school(school_id));
create policy "parents read their children" on public.students
  for select to authenticated using (public.is_parent_of(id));
create policy "parents read their children's classes" on public.student_enrolments
  for select to authenticated using (public.is_parent_of(student_id));
create policy "parents read their children's results" on public.exam_results
  for select to authenticated using (public.is_parent_of(student_id));
create policy "parents read shared notes" on public.student_notes
  for select to authenticated using (shared_with_parents and public.is_parent_of(student_id));

-- Requests: parents create/cancel through functions and read their own;
-- staff who can see the student read and answer them.
create policy "parents read their requests" on public.parent_requests
  for select to authenticated using (public.is_parent_of(student_id));
create policy "staff read requests for their students" on public.parent_requests
  for select to authenticated using (public.can_see_student(student_id));
create policy "staff answer requests" on public.parent_requests
  for update to authenticated using (public.can_see_student(student_id))
  with check (public.can_see_student(student_id));
create policy "admins log requests" on public.parent_requests
  for insert to authenticated with check (public.is_school_admin(school_id));

-- Fees: owners/admins manage structure and dues; payments only via
-- record_payment / cancel_payment; parents read their children's.
create policy "admins manage fee heads" on public.fee_heads
  for all to authenticated using (public.is_school_admin(school_id)) with check (public.is_school_admin(school_id));
create policy "parents read fee heads" on public.fee_heads
  for select to authenticated using (public.is_parent_in_school(school_id));

create policy "admins manage fee schedule" on public.fee_schedule
  for all to authenticated using (public.is_school_admin(school_id)) with check (public.is_school_admin(school_id));

create policy "admins manage dues" on public.fee_invoices
  for all to authenticated using (public.is_school_admin(school_id)) with check (public.is_school_admin(school_id));
create policy "parents read their children's dues" on public.fee_invoices
  for select to authenticated using (public.is_parent_of(student_id));

create policy "admins read payments" on public.fee_payments
  for select to authenticated using (public.is_school_admin(school_id));
create policy "parents read their children's payments" on public.fee_payments
  for select to authenticated using (public.is_parent_of(student_id));

create policy "admins read allocations" on public.fee_allocations
  for select to authenticated using (public.is_school_admin(school_id));
create policy "parents read their children's allocations" on public.fee_allocations
  for select to authenticated using (exists (
    select 1 from public.fee_payments p where p.id = payment_id and public.is_parent_of(p.student_id)
  ));

-- ---------------------------------------------------------- backfill links ---

select public.link_guardians_for(student_id) from public.student_private;
