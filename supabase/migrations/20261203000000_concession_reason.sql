-- A concession needs a remark (why it was given), and the database records
-- who gave it and when. Enforced here so no screen or script can skip it;
-- the fee report lists each concession with its remark.
-- Only a signed-in person is held to it: service-role imports from the old
-- fee system carry no remark. The one concession given before this keeps no
-- remark.

alter table public.fee_invoices
  add column concession_reason text check (concession_reason is null or length(concession_reason) <= 200),
  add column concession_by text,
  add column concession_at timestamptz;

create function public.fee_concession_remark() returns trigger
language plpgsql set search_path = '' as $$
declare
  v_old numeric := case when tg_op = 'UPDATE' then old.concession else 0 end;
  v_old_reason text := case when tg_op = 'UPDATE' then old.concession_reason end;
begin
  new.concession_reason := nullif(trim(new.concession_reason), '');
  if new.concession <= 0 then
    -- No concession, so no remark
    new.concession_reason := null;
    new.concession_by := null;
    new.concession_at := null;
  elsif new.concession is distinct from v_old or new.concession_reason is distinct from v_old_reason then
    if new.concession_reason is null and public.current_email() is not null then
      raise exception 'concession-reason' using errcode = 'P0001', hint = 'Add a remark saying why the concession is given.';
    end if;
    new.concession_by := coalesce(public.current_email(), new.concession_by);
    new.concession_at := now();
  end if;
  return new;
end
$$;

create trigger fee_invoices_concession_remark before insert or update on public.fee_invoices
  for each row execute function public.fee_concession_remark();
