#!/usr/bin/env node
// One-off, read-only: why doesn't generate_invoices() create dues for the
// newly-imported MIS2026-27xxx students? Checks their enrolment row against
// the fee schedule's session and class values, and checks fee_invoices
// directly (not through the balance view) to rule out a view/RLS quirk.
//
//   SUPABASE_SECRET_KEY=... node scripts/diagnose-new-admissions.mjs

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

const sample = await sbAll(`students?select=id,school_id,admission_no,name&admission_no=like.MIS2026-27*&limit=5`);
console.log("Sample new students:", sample.map((s) => `${s.admission_no} ${s.name} (${s.id})`).join("\n"));

const ids = sample.map((s) => s.id);
const invoices = await sbAll(`fee_invoices?select=id,student_id,session_id,head_id,period,label,amount,concession,due_date&student_id=in.(${ids.join(",")})`);
console.log(`\nfee_invoices rows for these 5 students: ${invoices.length}`);
console.log(JSON.stringify(invoices, null, 2));

const balances = await sbAll(`fee_invoice_balances?select=id,student_id,balance,amount,concession&student_id=in.(${ids.join(",")})`);
console.log(`\nfee_invoice_balances rows for these 5 students (through the view): ${balances.length}`);
console.log(JSON.stringify(balances, null, 2));
