-- Faster Students and Fees pages for owners and admins.
--
-- Row-level security checked "may this person see this row?" once per
-- student, due and payment: 731 students took 1.1 s and their fee totals
-- 5.7 s. These functions check once that the caller is an owner or admin of
-- the school, then read everything in one go. Anyone else (teachers,
-- parents) gets nothing from them and keeps using the normal, row-checked
-- reads, which only cover their own few students.

create function public.is_session_admin(session uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.academic_sessions a
    where a.id = session and public.is_school_admin(a.school_id)
  )
$$;

-- Every enrolled student in the session with their record and private
-- details, shaped like the app's usual read (enrolment + student + private).
create function public.session_students(session uuid) returns setof jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_session_admin(session) then
    return;
  end if;
  return query
    select jsonb_build_object(
      'class', e.class,
      'section', e.section,
      'stream', e.stream,
      'roll_no', e.roll_no,
      'status', e.status,
      'student', to_jsonb(s) || jsonb_build_object('private', to_jsonb(p))
    )
    from public.student_enrolments e
    join public.students s on s.id = e.student_id
    left join public.student_private p on p.student_id = s.id
    where e.session_id = session
    order by e.student_id;
end
$$;

-- Fee totals per student for the session (same figures as the
-- fee_student_totals view).
create function public.session_fee_totals(session uuid)
returns table (student_id uuid, billed numeric, paid numeric, balance numeric, due_now numeric, next_due_date date)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_session_admin(session) then
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
$$;

revoke execute on function public.is_session_admin(uuid) from public, anon;
revoke execute on function public.session_students(uuid) from public, anon;
revoke execute on function public.session_fee_totals(uuid) from public, anon;
grant execute on function public.is_session_admin(uuid) to authenticated;
grant execute on function public.session_students(uuid) to authenticated;
grant execute on function public.session_fee_totals(uuid) to authenticated;

-- The Fees page summaries use the fast totals for owners and admins too.
-- (Parents still get their own children's figures through the view.)
create or replace function public.fee_session_summary(session uuid)
returns table (billed numeric, collected numeric, outstanding numeric, due_now numeric, students_due bigint)
language plpgsql stable security invoker set search_path = '' as $$
begin
  if public.is_session_admin(session) then
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
$$;

create or replace function public.fee_class_summary(session uuid)
returns table (class text, students bigint, billed numeric, collected numeric, due_now numeric, outstanding numeric, students_due bigint)
language sql stable security invoker set search_path = '' as $$
  with t as materialized (
    select * from public.session_fee_totals(session)
  )
  select
    e.class,
    count(*),
    coalesce(sum(t.billed), 0),
    coalesce(sum(t.paid), 0),
    coalesce(sum(t.due_now), 0),
    coalesce(sum(t.balance), 0),
    count(*) filter (where t.due_now > 0)
  from public.student_enrolments e
  left join t on t.student_id = e.student_id
  where e.session_id = session and e.status <> 'left'
  group by e.class
$$;
