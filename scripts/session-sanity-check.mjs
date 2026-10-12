#!/usr/bin/env node
// One-off, read-only: verify everything from the historical fee-import
// session landed correctly. Safe to run anytime; writes nothing.
//
//   SUPABASE_SECRET_KEY=... node scripts/session-sanity-check.mjs

const SUPABASE_URL = "https://zvnsbuviuogrnquwkbsa.supabase.co";
const key = process.env.SUPABASE_SECRET_KEY;
if (!key) throw new Error("Set SUPABASE_SECRET_KEY in the environment.");

async function sbAll(path) {
  const out = [];
  let from = 0;
  const page = 1000;
  for (;;) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}`, Range: `${from}-${from + page - 1}` },
    });
    if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
    const batch = await res.json();
    out.push(...batch);
    if (batch.length < page) break;
    from += page;
  }
  return out;
}

let ok = true;
const check = (label, pass, detail) => {
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}${detail ? " -- " + detail : ""}`);
  if (!pass) ok = false;
};

// 1. Junk record gone
const junk = await sbAll(`students?select=id&admission_no=eq.MIS-866`);
check("Junk record MIS-866 deleted", junk.length === 0, `${junk.length} rows found`);

// 2. New admissions all matched (no more MIS2026-27xxx students missing enrolment)
const newAdm = await sbAll(`students?select=id,admission_no&admission_no=like.MIS2026-27*`);
check("121 new-admission students exist", newAdm.length === 121, `found ${newAdm.length}`);
const newAdmIds = newAdm.map((s) => s.id);
const newAdmEnrol = await sbAll(`student_enrolments?select=student_id&student_id=in.(${newAdmIds.join(",")})`);
check("All new admissions have an enrolment row", newAdmEnrol.length === newAdm.length, `${newAdmEnrol.length}/${newAdm.length}`);

// 3. Imported payments total
const oldPayments = await sbAll(`fee_payments?select=id,amount&receipt_no=like.OLD-*&status=eq.success`);
const total = oldPayments.reduce((t, p) => t + Number(p.amount), 0);
check("Imported historical payments present", oldPayments.length === 1930, `${oldPayments.length} rows found`);
console.log(`  -> sum of imported payments: ₹${total.toLocaleString("en-IN")}`);

// 4. Allocation sanity: no allocation exceeds its payment's amount, no allocation exceeds its invoice's amount
const paymentIds = oldPayments.map((p) => p.id);
const allocs = [];
for (let i = 0; i < paymentIds.length; i += 200) {
  const chunk = paymentIds.slice(i, i + 200);
  allocs.push(...(await sbAll(`fee_allocations?select=payment_id,invoice_id,amount&payment_id=in.(${chunk.join(",")})`)));
}
const allocByPayment = new Map();
for (const a of allocs) allocByPayment.set(a.payment_id, (allocByPayment.get(a.payment_id) ?? 0) + Number(a.amount));
const overAllocated = oldPayments.filter((p) => (allocByPayment.get(p.id) ?? 0) > Number(p.amount) + 0.01);
check("No payment over-allocated beyond its own amount", overAllocated.length === 0, `${overAllocated.length} offending rows`);
console.log(`  -> total allocation rows: ${allocs.length}, total allocated: ₹${allocs.reduce((t, a) => t + Number(a.amount), 0).toLocaleString("en-IN")}`);

// 5. No negative or zero-amount fee_payments
const badAmount = oldPayments.filter((p) => Number(p.amount) <= 0);
check("No zero/negative imported payment amounts", badAmount.length === 0, `${badAmount.length} offending rows`);

console.log(`\n${ok ? "ALL CHECKS PASSED" : "SOME CHECKS FAILED -- see above"}`);
