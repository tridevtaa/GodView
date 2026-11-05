-- Certificates for a student: bona fide, leaving (SLC), no dues, character, fee
-- paid and date of birth. Owners and admins issue them.
--
-- Each is a record in a register: a serial number per kind, and what it said
-- when issued (details), so a reprint matches the original even if the student's
-- record changes later. Nothing is deleted: a mistake is cancelled, with a
-- reason, and stays in the register. A second leaving certificate is marked as a
-- duplicate.

create table public.student_certificates (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  student_id uuid not null,
  kind text not null check (kind in ('bonafide', 'slc', 'no_dues', 'character', 'fee_paid', 'dob')),
  serial_no text not null,
  is_duplicate boolean not null default false,
  details jsonb not null,
  issued_on date not null,
  issued_by text,
  cancelled_at timestamptz,
  cancelled_by text,
  cancel_reason text check (length(cancel_reason) <= 200),
  created_at timestamptz not null default now(),
  unique (school_id, serial_no),
  foreign key (student_id, school_id) references public.students (id, school_id) on delete restrict
);
create index student_certificates_student on public.student_certificates (student_id, created_at desc);

grant select on public.student_certificates to authenticated;
alter table public.student_certificates enable row level security;
create policy "admins read certificates" on public.student_certificates
  for select to authenticated using (public.is_school_admin(school_id));

-- Issues one: the next serial number of its kind. A no dues certificate is
-- refused while anything is due by today, whatever the screen showed.
create function public.issue_certificate(p_student uuid, p_kind text, p_details jsonb, p_issued_on date)
returns public.student_certificates
language plpgsql security definer set search_path = '' as $$
declare
  s public.students;
  n bigint;
  prefix text;
  saved public.student_certificates;
begin
  select * into s from public.students where id = p_student;
  if s.id is null or not public.is_school_admin(s.school_id) then
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
$$;

create function public.cancel_certificate(p_id uuid, p_reason text) returns public.student_certificates
language plpgsql security definer set search_path = '' as $$
declare
  saved public.student_certificates;
begin
  update public.student_certificates
     set cancelled_at = now(), cancelled_by = public.current_email(), cancel_reason = nullif(trim(p_reason), '')
   where id = p_id and cancelled_at is null and public.is_school_admin(school_id)
  returning * into saved;
  if saved.id is null then
    raise exception 'not allowed';
  end if;
  return saved;
end
$$;

revoke execute on function public.issue_certificate(uuid, text, jsonb, date) from public, anon;
revoke execute on function public.cancel_certificate(uuid, text) from public, anon;
grant execute on function public.issue_certificate(uuid, text, jsonb, date) to authenticated;
grant execute on function public.cancel_certificate(uuid, text) to authenticated;
