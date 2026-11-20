-- Collect particular dues: the office ticks the months (and fee types) the
-- parent is paying for, and the payment goes to those first, oldest first.
-- Anything over their total goes to the other dues, oldest first, as before.
-- Without a list it works as before.
-- Also: the app's record_payment still checked "owner or admin" instead of
-- the Fees permission, so an admin with Fees turned off could still collect
-- and a principal given Fees Edit couldn't. It now asks can_wide(fees, Edit)
-- like the rest of the fee functions.

drop function public.record_payment(uuid, numeric, text, text, date, text, text, jsonb);

create function public.record_payment(
  p_student uuid,
  p_amount numeric,
  p_method text,
  p_reference text,
  p_paid_on date,
  p_note text,
  p_collected_by text,
  p_device jsonb default null,
  p_dues uuid[] default null
)
returns table (payment_id uuid, receipt_no text)
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
  if s.id is null or not public.can_wide(s.school_id, 'fees', 2) then
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

  -- The chosen dues first, then the rest; each group oldest first
  for due in
    select b.id, b.balance
    from public.fee_invoice_balances b
    where b.student_id = p_student and b.balance > 0
    order by (p_dues is not null and b.id = any (p_dues)) desc, b.due_date nulls first, b.created_at
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

revoke execute on function public.record_payment(uuid, numeric, text, text, date, text, text, jsonb, uuid[]) from public, anon;
grant execute on function public.record_payment(uuid, numeric, text, text, date, text, text, jsonb, uuid[]) to authenticated;
