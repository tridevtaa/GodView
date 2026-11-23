-- A one-off charge on one student (a lost ID card, a trip, a late fine),
-- added from the student's Fees tab by anyone who can edit fees.
-- It goes under a "Miscellaneous" fee type, made the first time it's needed
-- (only the owner can add fee types directly, so this function does it).
-- Each charge gets its own period, so a student can have several.

create function public.add_misc_charge(p_student uuid, p_session uuid, p_amount numeric, p_label text)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_school uuid;
  v_head uuid;
  v_id uuid;
  v_label text := trim(coalesce(p_label, ''));
begin
  select school_id into v_school from public.students where id = p_student;
  if v_school is null or v_school not in (select public.schools_wide('fees', 2)) then
    raise exception 'not allowed';
  end if;
  if not exists (select 1 from public.academic_sessions where id = p_session and school_id = v_school) then
    raise exception 'unknown session';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'amount-positive' using errcode = 'P0001';
  end if;
  if length(v_label) not between 1 and 60 then
    raise exception 'label-length' using errcode = 'P0001';
  end if;

  select id into v_head from public.fee_heads
  where school_id = v_school and lower(name) = 'miscellaneous'
  order by created_at
  limit 1;
  if v_head is null then
    insert into public.fee_heads (school_id, name, sort)
    values (v_school, 'Miscellaneous', 1000)
    on conflict (school_id, name) do update set name = excluded.name
    returning id into v_head;
  end if;

  insert into public.fee_invoices (school_id, session_id, student_id, head_id, period, label, amount, due_date, updated_by)
  values (
    v_school, p_session, p_student, v_head,
    'misc-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12),
    v_label, round(p_amount, 2), current_date, public.current_email()
  )
  returning id into v_id;
  return v_id;
end
$$;

revoke execute on function public.add_misc_charge(uuid, uuid, numeric, text) from public, anon;
grant execute on function public.add_misc_charge(uuid, uuid, numeric, text) to authenticated;
