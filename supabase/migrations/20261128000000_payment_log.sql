-- Who collected each payment, and a log of every payment received or
-- cancelled that only owners can read.
--
-- fee_payments.collected_by: the person who took the money (required when
--   the office records a payment).
-- fee_payment_log: one row per payment received or cancelled, written by the
--   database itself (triggers on fee_payments), so it can't be skipped or
--   edited: when, who was signed in (id and email), who collected, the
--   amount, method, reference and receipt, the IP address and browser the
--   request came from, and the device details the app sends.
-- record_payment: takes who collected it (required) and the device details.
--   The old version (no collected_by) stays until every open app has updated.
-- cancel_payment: also takes the device details.

alter table public.fee_payments add column collected_by text check (length(collected_by) <= 80);

create table public.fee_payment_log (
  id bigint generated always as identity primary key,
  school_id uuid not null references public.schools (id) on delete cascade,
  payment_id uuid references public.fee_payments (id) on delete set null, -- kept if the payment goes
  student_id uuid references public.students (id) on delete set null,
  event text not null check (event in ('received', 'cancelled')),
  at timestamptz not null default now(),
  user_id uuid,
  user_email text,
  collected_by text,
  amount numeric(12, 2),
  method text,
  reference text,
  receipt_no text,
  paid_on date,
  note text,
  ip text,
  user_agent text,
  device jsonb
);

create index fee_payment_log_school on public.fee_payment_log (school_id, at desc);
create index fee_payment_log_payment on public.fee_payment_log (payment_id);

grant select on public.fee_payment_log to authenticated;
alter table public.fee_payment_log enable row level security;
create policy "owners read the payment log" on public.fee_payment_log
  for select to authenticated using (public.is_owner(school_id));

-- The request's IP address and browser, from the API's request headers.
create function public.request_header(name text) returns text
language sql stable set search_path = '' as $$
  select nullif(current_setting('request.headers', true), '')::json ->> name
$$;
revoke execute on function public.request_header(text) from public, anon, authenticated;

create function public.log_fee_payment() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  ev text;
  dev jsonb;
begin
  if tg_op = 'INSERT' then
    ev := 'received';
  elsif new.status = 'cancelled' and old.status is distinct from 'cancelled' then
    ev := 'cancelled';
  else
    return null;
  end if;
  begin
    dev := nullif(current_setting('godview.device', true), '')::jsonb;
  exception when others then
    dev := null;
  end;
  insert into public.fee_payment_log (school_id, payment_id, student_id, event, user_id, user_email, collected_by,
    amount, method, reference, receipt_no, paid_on, note, ip, user_agent, device)
  values (new.school_id, new.id, new.student_id, ev, auth.uid(), public.current_email(), new.collected_by,
    new.amount, new.method, new.reference, new.receipt_no, new.paid_on, new.note,
    left(split_part(coalesce(public.request_header('x-forwarded-for'), public.request_header('x-real-ip'), ''), ',', 1), 64),
    left(public.request_header('user-agent'), 400), dev);
  return null;
end
$$;
revoke execute on function public.log_fee_payment() from public, anon, authenticated;

create trigger fee_payments_log after insert or update of status on public.fee_payments
  for each row execute function public.log_fee_payment();

-- Payments recorded in Godview before the log: one row each from what's known.
insert into public.fee_payment_log (school_id, payment_id, student_id, event, at, user_email, amount, method, reference, receipt_no, paid_on, note)
select p.school_id, p.id, p.student_id, 'received', p.created_at, p.received_by, p.amount, p.method, p.reference, p.receipt_no, p.paid_on,
  coalesce(p.note || ' · ', '') || 'Logged before the payment log started'
from public.fee_payments p
where p.receipt_no not like 'OLD-%' and p.gateway is null;

create function public.record_payment(
  p_student uuid,
  p_amount numeric,
  p_method text,
  p_reference text,
  p_paid_on date,
  p_note text,
  p_collected_by text,
  p_device jsonb default null
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
  if coalesce(trim(p_collected_by), '') = '' then
    raise exception 'say who collected it';
  end if;
  perform set_config('godview.device', coalesce(p_device::text, ''), true);

  -- Serialise payments for this student so two at once can't pay the same due.
  perform 1 from public.fee_invoices where student_id = p_student for update;

  rno := public.next_receipt_no(s.school_id);
  insert into public.fee_payments (school_id, student_id, amount, method, reference, paid_on, receipt_no, received_by, note, collected_by)
  values (s.school_id, p_student, p_amount, p_method, nullif(trim(p_reference), ''), coalesce(p_paid_on, current_date),
          rno, public.current_email(), nullif(trim(p_note), ''), left(trim(p_collected_by), 80))
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
revoke execute on function public.record_payment(uuid, numeric, text, text, date, text, text, jsonb) from public, anon;
grant execute on function public.record_payment(uuid, numeric, text, text, date, text, text, jsonb) to authenticated;

drop function public.cancel_payment(uuid);
create function public.cancel_payment(payment uuid, p_device jsonb default null) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform set_config('godview.device', coalesce(p_device::text, ''), true);
  update public.fee_payments set status = 'cancelled'
   where id = payment and status = 'success' and public.is_school_admin(school_id);
  if not found then
    raise exception 'not allowed';
  end if;
end
$$;
revoke execute on function public.cancel_payment(uuid, jsonb) from public, anon;
grant execute on function public.cancel_payment(uuid, jsonb) to authenticated;
