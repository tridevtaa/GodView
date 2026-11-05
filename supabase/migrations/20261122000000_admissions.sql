-- Admissions: a child moves through Enquiry, Registration and Admission here,
-- and only becomes a student at the end. Applicants are kept apart from
-- students on purpose: students feed attendance, fees, reports and parent
-- logins, and someone who only enquired must not show up in any of those.
--
-- An application's id becomes the student's id when admitted, so documents
-- uploaded during registration are already at the student's storage path.
--
-- Each school decides (schools.admission_fee_mode) whether the registration
-- fee is kept separate or counted towards the child's fees once admitted. The
-- choice is copied onto each registration, so changing it later doesn't alter
-- fees already taken. Counted fees become a normal payment on admission, with
-- the same receipt number and date.

alter table public.schools
  add column admission_fee_mode text not null default 'separate' check (admission_fee_mode in ('separate', 'adjust')),
  add column admission_fee numeric(12, 2) check (admission_fee >= 0),
  add column admission_test boolean not null default false;

-- Seats per grade: a warning when admitting, never a block.
alter table public.school_grades
  add column seats int check (seats between 1 and 5000);

create table public.admissions (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  stage text not null default 'enquiry' check (stage in ('enquiry', 'registered', 'admitted', 'lost')),
  -- Enquiry
  name text not null check (length(trim(name)) between 1 and 80),
  class_wanted text check (length(class_wanted) <= 40),
  session_name text check (session_name ~ '^\d{4}-\d{2}$'),
  parent_phone text check (length(parent_phone) <= 20),
  source text check (length(source) <= 40),
  follow_up date,
  note text check (length(note) <= 1000),
  -- Registration
  gender text not null default '' check (gender in ('', 'F', 'M')),
  dob date,
  parent_name text check (length(parent_name) <= 80),
  mother_name text check (length(mother_name) <= 80),
  mother_phone text check (length(mother_phone) <= 20),
  email text check (length(email) <= 200),
  address text check (length(address) <= 300),
  aadhaar_doc_path text,
  birth_cert_path text,
  transfer_cert_path text,
  registration_no text,
  registered_on date,
  fee numeric(12, 2) check (fee >= 0),
  fee_method text check (fee_method in ('cash', 'cheque', 'upi', 'card', 'netbanking', 'bank_transfer', 'online')),
  fee_reference text check (length(fee_reference) <= 80),
  fee_paid_on date,
  fee_receipt_no text,
  fee_mode text check (fee_mode in ('separate', 'adjust')),
  -- The optional test or interview
  test_on date,
  test_result text check (test_result in ('passed', 'not_selected')),
  -- Not joining: why, and where to go back to if they change their mind
  lost_reason text check (length(lost_reason) <= 200),
  lost_from text check (lost_from in ('enquiry', 'registered')),
  admitted_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by text,
  unique (school_id, registration_no),
  unique (id, school_id)
);
create index admissions_school_stage on public.admissions (school_id, stage, follow_up);

create function public.admissions_touch() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end
$$;
revoke execute on function public.admissions_touch() from public, anon, authenticated;
create trigger admissions_touch before update on public.admissions
  for each row execute function public.admissions_touch();

grant select, insert, update, delete on public.admissions to authenticated;
alter table public.admissions enable row level security;
create policy "admins manage admissions" on public.admissions
  for all to authenticated using (public.is_school_admin(school_id)) with check (public.is_school_admin(school_id));
create policy "principal reads admissions" on public.admissions
  for select to authenticated using (public.is_principal(school_id));

-- A payment that started as a registration fee. Only these are ever applied to
-- new dues on their own: other spare money, such as imported fee history, must
-- never be allocated automatically.
alter table public.fee_payments
  add column admission_id uuid references public.admissions (id) on delete set null;
create index fee_payments_admission_credit on public.fee_payments (student_id) where admission_id is not null;

-- ---------------------------------------------------------------- settings ---

-- Admins as well as owners; schools and grades can only be edited by owners
-- directly, so this touches nothing but the admission settings.
create function public.set_admission_settings(p_school uuid, p_mode text, p_fee numeric, p_test boolean)
returns public.schools
language plpgsql security definer set search_path = '' as $$
declare
  saved public.schools;
begin
  if not public.is_school_admin(p_school) then
    raise exception 'not allowed';
  end if;
  update public.schools
     set admission_fee_mode = p_mode, admission_fee = p_fee, admission_test = coalesce(p_test, false)
   where id = p_school
  returning * into saved;
  return saved;
end
$$;

-- p_seats: { "<grade code>": seats or null }
create function public.set_grade_seats(p_school uuid, p_seats jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_school_admin(p_school) then
    raise exception 'not allowed';
  end if;
  update public.school_grades g
     set seats = nullif(p_seats ->> g.code, '')::int
   where g.school_id = p_school and p_seats ? g.code;
end
$$;

-- ------------------------------------------------------------ registration ---

-- Moves an enquiry to Registered: gives it the next registration number and,
-- if a fee was taken, the next number in the school's receipt series.
create function public.register_admission(p_id uuid, p_fee numeric, p_method text, p_reference text, p_paid_on date)
returns public.admissions
language plpgsql security definer set search_path = '' as $$
declare
  a public.admissions;
  n bigint;
  amount numeric := coalesce(p_fee, 0);
begin
  select * into a from public.admissions where id = p_id for update;
  if a.id is null or not public.is_school_admin(a.school_id) then
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
$$;

-- --------------------------------------------------------------- admission ---

-- Marks it Admitted once the student exists (same id). A fee the school counts
-- towards fees becomes a payment now, applied to any dues the student has.
create function public.finish_admission(p_id uuid) returns public.admissions
language plpgsql security definer set search_path = '' as $$
declare
  a public.admissions;
  pid uuid;
  remaining numeric;
  due record;
  take numeric;
begin
  select * into a from public.admissions where id = p_id for update;
  if a.id is null or not public.is_school_admin(a.school_id) then
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
$$;

-- A new student usually has no dues yet: they're raised later, from the Fee
-- structure. Spare money stays unapplied by default, which would show the child
-- owing the full amount, so a counted registration fee goes to dues as they're
-- raised. Only payments marked with admission_id, so nothing else moves.
create function public.apply_admission_credit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  remaining numeric := new.amount - new.concession;
  p record;
  take numeric;
begin
  if remaining <= 0 then
    return new;
  end if;
  for p in
    select fp.id, fp.amount - coalesce((select sum(fa.amount) from public.fee_allocations fa where fa.payment_id = fp.id), 0) as spare
    from public.fee_payments fp
    where fp.student_id = new.student_id and fp.admission_id is not null and fp.status = 'success'
    order by fp.paid_on, fp.created_at
  loop
    exit when remaining <= 0;
    take := least(remaining, p.spare);
    if take > 0 then
      insert into public.fee_allocations (payment_id, invoice_id, school_id, amount)
      values (p.id, new.id, new.school_id, take);
      remaining := remaining - take;
    end if;
  end loop;
  return new;
end
$$;
revoke execute on function public.apply_admission_credit() from public, anon, authenticated;
create trigger apply_admission_credit after insert on public.fee_invoices
  for each row execute function public.apply_admission_credit();

revoke execute on function public.set_admission_settings(uuid, text, numeric, boolean) from public, anon;
revoke execute on function public.set_grade_seats(uuid, jsonb) from public, anon;
revoke execute on function public.register_admission(uuid, numeric, text, text, date) from public, anon;
revoke execute on function public.finish_admission(uuid) from public, anon;
grant execute on function public.set_admission_settings(uuid, text, numeric, boolean) to authenticated;
grant execute on function public.set_grade_seats(uuid, jsonb) to authenticated;
grant execute on function public.register_admission(uuid, numeric, text, text, date) to authenticated;
grant execute on function public.finish_admission(uuid) to authenticated;
