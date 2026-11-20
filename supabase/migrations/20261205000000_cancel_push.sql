-- Owners hear about every cancelled payment, straight away:
--   Payment Cancelled        ₹4,650 for Loveleen Saini (OLD-1925-MIS-266) by Ramesh
-- Tapping it opens the payment log. Whoever cancelled it isn't told about
-- their own cancel. The database sends it (a trigger on the payment log
-- calls push-message), so it can't be skipped by the app or an old version.

alter table public.fee_payment_log add column pushed_at timestamptz;

-- Who hears about a cancel, once, while it is new: each owner's devices.
create function public.cancel_push(p_log bigint)
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
      || coalesce(' by ' || who, ''), 180),
    '/?go=payment-log', d.platform
  from public.staff_devices() d
  join public.school_members sm on lower(sm.email) = d.email
  where sm.school_id = l.school_id
    and sm.role::text = 'owner'
    and d.email is distinct from lower(l.user_email);
end
$$;

revoke execute on function public.cancel_push(bigint) from public, anon, authenticated;

-- A cancel in the log asks push-message to send it (after this commits).
create function public.push_cancelled_payment() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform net.http_post(
    url := 'https://zvnsbuviuogrnquwkbsa.supabase.co/functions/v1/push-message',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', 'sb_publishable_3aU-A4OMVSTduMaDnEnJJA_j4PTeZOZ',
      'Authorization', 'Bearer sb_publishable_3aU-A4OMVSTduMaDnEnJJA_j4PTeZOZ'
    ),
    body := jsonb_build_object('cancel', new.id)
  );
  return null;
exception when others then
  -- A notification must never stop the cancel itself
  return null;
end
$$;

revoke execute on function public.push_cancelled_payment() from public, anon, authenticated;

create trigger fee_payment_log_push after insert on public.fee_payment_log
  for each row when (new.event = 'cancelled')
  execute function public.push_cancelled_payment();
