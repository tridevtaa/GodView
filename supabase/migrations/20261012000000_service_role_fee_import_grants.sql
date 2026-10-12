-- service_role (the secret key) has no table-level grants on students or
-- fee_payments; writes normally go through record_payment(), a security
-- definer function, so this was never needed before. One-off bulk-import
-- scripts (scripts/fee-payments-import.mjs) read students directly and
-- insert fee_payments rows directly, bypassing that function, so they need
-- the grants spelled out here.

grant select on public.students to service_role;
grant select, insert on public.fee_payments to service_role;

-- scripts/fee-payments-allocate.mjs links imported payments to the dues they
-- cover (same bookkeeping record_payment() does inline for a live payment).
grant select on public.fee_invoices to service_role;
grant select, insert on public.fee_allocations to service_role;
grant select on public.fee_invoice_balances to service_role;

-- scripts/diagnose-new-admissions.mjs reads these to see why generate_invoices()
-- isn't creating dues for the newly-imported students.
grant select on public.student_enrolments to service_role;
grant select on public.academic_sessions to service_role;
grant select on public.fee_schedule to service_role;
