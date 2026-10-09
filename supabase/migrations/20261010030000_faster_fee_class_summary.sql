-- Dues by class was slow on a real school (730 students, 12 monthly dues
-- each): the planner re-added every student's fees for each enrolment and
-- the Fees page timed out. Add up the totals once, then group by class.

create or replace function public.fee_class_summary(session uuid)
returns table (class text, students bigint, billed numeric, collected numeric, due_now numeric, outstanding numeric, students_due bigint)
language sql stable security invoker set search_path = '' as $$
  with t as materialized (
    select student_id, billed, paid, due_now, balance
    from public.fee_student_totals
    where session_id = session
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
