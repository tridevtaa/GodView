#!/usr/bin/env node
// One-off, read-only: of the 121 new-admission (MIS2026-27xxx) payments,
// which ones still have no matching open due, and why.
//
//   SUPABASE_SECRET_KEY=... node scripts/diagnose-unallocated-new-admissions.mjs

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

const students = await sbAll(`students?select=id,admission_no,name&admission_no=like.MIS2026-27*`);
const payments = await sbAll(`fee_payments?select=id,student_id,amount,receipt_no&receipt_no=like.OLD-*&status=eq.success`);
const byStudent = new Map(students.map((s) => [s.id, s]));
const newAdmPayments = payments.filter((p) => byStudent.has(p.student_id));

const paymentIds = newAdmPayments.map((p) => p.id);
const allocs = [];
for (let i = 0; i < paymentIds.length; i += 200) {
  const chunk = paymentIds.slice(i, i + 200);
  allocs.push(...(await sbAll(`fee_allocations?select=payment_id,amount&payment_id=in.(${chunk.join(",")})`)));
}
const allocByPayment = new Map();
for (const a of allocs) allocByPayment.set(a.payment_id, (allocByPayment.get(a.payment_id) ?? 0) + Number(a.amount));

const unallocated = newAdmPayments.filter((p) => (allocByPayment.get(p.id) ?? 0) < Number(p.amount) - 0.01);
console.log(`New-admission payments still unallocated: ${unallocated.length}`);

for (const p of unallocated) {
  const s = byStudent.get(p.student_id);
  const enrol = await sbAll(`student_enrolments?select=class,section,status,session_id&student_id=eq.${p.student_id}`);
  const invoices = await sbAll(`fee_invoices?select=id,period,amount&student_id=eq.${p.student_id}`);
  console.log(`\n${s.admission_no} ${s.name} -- payment ₹${p.amount} (${p.receipt_no})`);
  console.log(`  enrolment: ${JSON.stringify(enrol)}`);
  console.log(`  invoices: ${invoices.length} rows${invoices.length ? ", first: " + JSON.stringify(invoices[0]) : " (none at all)"}`);
}
