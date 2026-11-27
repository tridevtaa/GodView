-- Cancelling a payment that was paid needs a remark (why: wrong entry,
-- bounced cheque…). Enforced here so no screen or script can skip it.
-- The payment keeps the remark, who cancelled it and when; the owner's
-- payment log and the owners' "Payment Cancelled" notification show it.
-- Payments cancelled before this keep no remark.
--
-- cancel_payment now takes p_reason. Its old version (no remark) is
-- dropped, so an app that hasn't updated can't cancel until it does.

alter table public.fee_payments
  add column cancel_reason text check (cancel_reason is null or length(cancel_reason) <= 200),
  add column cancelled_by text,
  add column cancelled_at timestamptz;

alter table public.fee_payment_log add column cancel_reason text;

drop function public.cancel_payment(uuid, jsonb);
create function public.cancel_payment(payment uuid, p_reason text, p_device jsonb default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_reason text := left(nullif(trim(p_reason), ''), 200);
begin
  if v_reason is null then
    raise exception 'cancel-reason' using errcode = 'P0001', hint = 'Add a remark saying why the payment is cancelled.';
  end if;
  perform set_config('godview.device', coalesce(p_device::text, ''), true);
  update public.fee_payments
     set status = 'cancelled', cancel_reason = v_reason, cancelled_by = public.current_email(), cancelled_at = now()
   where id = payment and status = 'success' and public.can_wide(school_id, 'fees', 2);
  if not found then
    raise exception 'not allowed';
  end if;
end
$$;
revoke execute on function public.cancel_payment(uuid, text, jsonb) from public, anon;
grant execute on function public.cancel_payment(uuid, text, jsonb) to authenticated;

-- The log row for a cancel carries its remark.
create or replace function public.log_fee_payment() returns trigger
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
    amount, method, reference, receipt_no, paid_on, note, ip, user_agent, device, cancel_reason)
  values (new.school_id, new.id, new.student_id, ev, auth.uid(), public.current_email(), new.collected_by,
    new.amount, new.method, new.reference, new.receipt_no, new.paid_on, new.note,
    left(split_part(coalesce(public.request_header('x-forwarded-for'), public.request_header('x-real-ip'), ''), ',', 1), 64),
    left(public.request_header('user-agent'), 400), dev,
    case when ev = 'cancelled' then new.cancel_reason end);
  return null;
end
$$;
revoke execute on function public.log_fee_payment() from public, anon, authenticated;

-- The owners' notification ends with the remark:
--   ₹4,650 for Loveleen Saini (OLD-1925-MIS-266) by Ramesh: Bounced cheque
create or replace function public.cancel_push(p_log bigint)
returns table (sub_endpoint text, sub_p256dh text, sub_auth text, title text, body text, url text, platform text)
language plpgsql security definer set search_path = '' as $$
declare
  l public.fee_payment_log;
  child text;
  who text;
begin
  update public.fee_payment_log x set pushed_at = now()
  where x.id = p_log and x.event = 'cancelled' and x.pushed_at is null and x.at > now() - interval '10 minutes'
  returning * into l;
  if l.id is null then
    return;
  end if;

  select trim(s.name) into child from public.students s where s.id = l.student_id;
  select coalesce(public.first_name(sm.full_name), l.user_email) into who
  from public.school_members sm
  where sm.school_id = l.school_id and lower(sm.email) = lower(l.user_email);
  who := coalesce(who, l.user_email);

  return query
  select d.endpoint, d.p256dh, d.auth, 'Payment Cancelled',
    left(public.rupees(l.amount)
      || coalesce(' for ' || nullif(child, ''), '')
      || coalesce(' (' || l.receipt_no || ')', '')
      || coalesce(' by ' || who, '')
      || coalesce(': ' || l.cancel_reason, ''), 180),
    '/?go=payment-log', d.platform
  from public.staff_devices() d
  join public.school_members sm on lower(sm.email) = d.email
  where sm.school_id = l.school_id
    and sm.role::text = 'owner'
    and d.email is distinct from lower(l.user_email);
end
$$;
revoke execute on function public.cancel_push(bigint) from public, anon, authenticated;
