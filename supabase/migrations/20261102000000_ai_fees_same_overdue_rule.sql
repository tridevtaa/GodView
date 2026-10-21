-- Fees insights count overdue students the way the app does, so Home's
-- "N students overdue" and the AI agree: everyone not marked left
-- (inactive students still owe), overdue once their oldest unpaid due is
-- more than 15 days old, owing everything due by today. Also adds due_now
-- and students_due, the app's "Due now" figures.

create or replace function public.ai_fees_pack(p_school uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  sess uuid := public.current_session(p_school);
  d date := public.ist_today();
  out jsonb;
begin
  if not (coalesce(auth.role(), '') = 'service_role' or public.is_school_admin(p_school)) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if sess is null then
    return jsonb_build_object('error', 'no session');
  end if;

  with
  enrolled as (
    select e.student_id, e.class, coalesce(e.section, '') as section,
      public.class_text(e.class, e.section) as class_name, s.name
    from public.student_enrolments e
    join public.students s on s.id = e.student_id
    where e.session_id = sess and e.status <> 'left'
  ),
  inv as (
    select b.*, en.class, en.class_name, en.name
    from public.fee_invoice_balances b
    join enrolled en on en.student_id = b.student_id
    where b.session_id = sess
  ),
  pays as (
    select p.* from public.fee_payments p
    join enrolled en on en.student_id = p.student_id
    where p.school_id = p_school and p.status = 'success'
  ),
  -- Reminders reach a family when a parent has the app with notifications on
  reach as (
    select distinct gs.student_id
    from public.guardian_students gs
    join public.guardians g on g.id = gs.guardian_id
    join public.parent_devices() pd on pd.phone = g.phone
    where gs.school_id = p_school and not gs.removed
  ),
  -- The app's rule (feeFields() in personMapping.js): a student is
  -- overdue when their oldest unpaid due is more than 15 days old; what
  -- they owe is everything due by today ("Due now").
  dues as (
    select i.student_id, i.name, i.class_name,
      coalesce(sum(i.balance) filter (where (i.due_date is null or i.due_date <= d) and i.balance > 0.009), 0) as due_now,
      min(i.due_date) filter (where i.balance > 0.009) as oldest_due,
      sum(i.concession) as concession
    from inv i group by i.student_id, i.name, i.class_name
  ),
  per_student as (
    select dues.*,
      case when due_now > 0 and oldest_due < d - 15 then due_now else 0 end as overdue
    from dues
  ),
  late as (
    -- How late each payment was against the due date it paid off
    select greatest(0, p.paid_on - i.due_date) as days_late
    from public.fee_allocations fa
    join pays p on p.id = fa.payment_id
    join inv i on i.id = fa.invoice_id
    where i.due_date is not null
  )
  select jsonb_build_object(
    'today', d,
    'session', (select a.name from public.academic_sessions a where a.id = sess),
    'students', (select count(*) from enrolled),
    'totals', (
      select jsonb_build_object(
        'billed', round(coalesce(sum(i.amount - i.concession), 0)),
        'concession', round(coalesce(sum(i.concession), 0)),
        'collected', round(coalesce(sum(i.paid), 0)),
        'outstanding', round(coalesce(sum(i.balance), 0)),
        'due_so_far', round(coalesce(sum(i.amount - i.concession) filter (where i.due_date <= d), 0)),
        'collected_of_due_so_far', round(coalesce(sum(i.paid) filter (where i.due_date <= d), 0)),
        'due_now', (select round(sum(due_now)) from per_student),
        'students_due', (select count(*) from per_student where due_now > 0),
        'overdue', (select round(coalesce(sum(overdue), 0)) from per_student),
        'collection_rate_pct', round(100 * coalesce(sum(i.paid) filter (where i.due_date <= d), 0)
          / nullif(sum(i.amount - i.concession) filter (where i.due_date <= d), 0)),
        'students_overdue', (select count(*) from per_student where overdue > 0),
        'students_with_concession', (select count(*) from per_student where concession > 0)
      ) from inv i
    ),
    'by_month', (
      select coalesce(jsonb_agg(m order by m->>'month'), '[]'::jsonb) from (
        select jsonb_build_object(
          'month', to_char(mm, 'YYYY-MM'),
          'due', round(coalesce((select sum(i.amount - i.concession) from inv i where date_trunc('month', i.due_date) = mm), 0)),
          'collected', round(coalesce((select sum(p.amount) from pays p where date_trunc('month', p.paid_on) = mm), 0)),
          'payments', (select count(*) from pays p where date_trunc('month', p.paid_on) = mm)
        ) as m
        from generate_series(date_trunc('month', d) - interval '11 months', date_trunc('month', d), interval '1 month') mm
      ) x
    ),
    'by_class', (
      select coalesce(jsonb_agg(c order by c->>'class'), '[]'::jsonb) from (
        select jsonb_build_object(
          'class', i.class_name,
          'students', count(distinct i.student_id),
          'due_so_far', round(coalesce(sum(i.amount - i.concession) filter (where i.due_date <= d), 0)),
          'collected', round(coalesce(sum(i.paid), 0)),
          'overdue', (select round(coalesce(sum(ps.overdue), 0)) from per_student ps where ps.class_name = i.class_name),
          'students_overdue', (select count(*) from per_student ps where ps.class_name = i.class_name and ps.overdue > 0),
          'collection_rate_pct', round(100 * coalesce(sum(i.paid) filter (where i.due_date <= d), 0)
            / nullif(sum(i.amount - i.concession) filter (where i.due_date <= d), 0))
        ) as c
        from inv i group by i.class_name
      ) x
    ),
    'overdue_age', (
      select jsonb_agg(jsonb_build_object('days', b.label, 'amount', round(coalesce(t.amount, 0)), 'students', coalesce(t.students, 0)) order by b.lo)
      from (values (16, 30, '16-30'), (31, 60, '31-60'), (61, 90, '61-90'), (91, 100000, '90+')) b (lo, hi, label)
      left join lateral (
        select sum(ps.overdue) as amount, count(*) as students
        from per_student ps
        where ps.overdue > 0 and (d - ps.oldest_due) between b.lo and b.hi
      ) t on true
    ),
    'payment_timing', (
      select jsonb_build_object(
        'allocations', count(*),
        'paid_by_due_date_pct', round(100.0 * count(*) filter (where days_late = 0) / nullif(count(*), 0)),
        'average_days_late', round(avg(days_late)),
        'paid_over_30_days_late_pct', round(100.0 * count(*) filter (where days_late > 30) / nullif(count(*), 0))
      ) from late
    ),
    'methods', (
      select coalesce(jsonb_agg(jsonb_build_object('method', p.method, 'payments', p.n, 'amount', p.amount) order by p.amount desc), '[]'::jsonb)
      from (select method, count(*) as n, round(sum(amount)) as amount from pays group by method) p
    ),
    'fee_heads', (
      select coalesce(jsonb_agg(jsonb_build_object('head', h.name, 'billed', x.billed, 'collected', x.collected, 'overdue', x.overdue) order by x.billed desc), '[]'::jsonb)
      from (
        select i.head_id, round(sum(i.amount - i.concession)) as billed, round(sum(i.paid)) as collected,
          round(coalesce(sum(i.balance) filter (where i.due_date < d - 15 and i.balance > 0.009), 0)) as overdue
        from inv i group by i.head_id
      ) x join public.fee_heads h on h.id = x.head_id
    ),
    'reminders_reach', (
      select jsonb_build_object(
        'students_overdue_parent_has_app', count(*) filter (where r.student_id is not null),
        'students_overdue_parent_no_app', count(*) filter (where r.student_id is null),
        'overdue_amount_parent_no_app', round(coalesce(sum(ps.overdue) filter (where r.student_id is null), 0))
      )
      from per_student ps left join reach r on r.student_id = ps.student_id
      where ps.overdue > 0
    ),
    'top_overdue', (
      select coalesce(jsonb_agg(t order by (t->>'overdue')::numeric desc), '[]'::jsonb) from (
        select jsonb_build_object(
          'id', ps.student_id,
          'name', ps.name,
          'class', ps.class_name,
          'overdue', round(ps.overdue),
          'days_overdue', d - ps.oldest_due,
          'last_payment', (select max(p.paid_on) from pays p where p.student_id = ps.student_id),
          'parent_has_app', exists (select 1 from reach r where r.student_id = ps.student_id)
        ) as t
        from per_student ps
        where ps.overdue > 0
        order by ps.overdue desc
        limit 25
      ) x
    )
  ) into out;
  return out;
end
$$;

