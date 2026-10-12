#!/usr/bin/env node
// One-off: link already-imported historical payments (receipt_no LIKE
// 'OLD-%', written by fee-payments-import.mjs) to the dues they cover, so
// GodView's balance calculation stops showing them as Overdue. Same
// allocation rule as record_payment(): oldest due first, by due_date then
// created_at; any leftover amount with no open due stays unallocated.
//
//   SUPABASE_SECRET_KEY=... node scripts/fee-payments-allocate.mjs [--write]
//
// Without --write this only previews what would be allocated. Safe to
// re-run: payments that already have allocations for their full amount are
// skipped.

const SUPABASE_URL = "https://zvnsbuviuogrnquwkbsa.supabase.co";
const key = process.env.SUPABASE_SECRET_KEY;
const write = process.argv.includes("--write");
if (!key) throw new Error("Set SUPABASE_SECRET_KEY in the environment (Project Settings → API Keys → secret).");

async function sb(path, init = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

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

// ---------------------------------------------------------------- fetch ---

const payments = await sbAll(
  `fee_payments?select=id,student_id,school_id,amount,paid_on&receipt_no=like.OLD-*&status=eq.success&order=paid_on`
);
console.log(`Imported payments found: ${payments.length}`);

const paymentIds = payments.map((p) => p.id);
const existingAllocs = [];
for (let i = 0; i < paymentIds.length; i += 200) {
  const chunk = paymentIds.slice(i, i + 200);
  const rows = await sbAll(`fee_allocations?select=payment_id,amount&payment_id=in.(${chunk.join(",")})`);
  existingAllocs.push(...rows);
}
const allocatedByPayment = new Map();
for (const a of existingAllocs) allocatedByPayment.set(a.payment_id, (allocatedByPayment.get(a.payment_id) ?? 0) + Number(a.amount));

const pending = payments
  .map((p) => ({ ...p, remaining: Number(p.amount) - (allocatedByPayment.get(p.id) ?? 0) }))
  .filter((p) => p.remaining > 0.009); // ignore rounding dust
console.log(`Already fully allocated (skipped): ${payments.length - pending.length}`);
console.log(`Pending allocation: ${pending.length}`);

const byStudent = new Map();
for (const p of pending) {
  if (!byStudent.has(p.student_id)) byStudent.set(p.student_id, []);
  byStudent.get(p.student_id).push(p);
}
for (const list of byStudent.values()) list.sort((a, b) => (a.paid_on < b.paid_on ? -1 : a.paid_on > b.paid_on ? 1 : 0));

// ------------------------------------------------------------- allocate ---

const toInsert = []; // { payment_id, invoice_id, school_id, amount }
let studentsWithNoOpenDues = 0;
let fullyCovered = 0;
let leftoverTotal = 0;

for (const [studentId, list] of byStudent) {
  const schoolId = list[0].school_id;
  const dues = await sbAll(
    `fee_invoice_balances?select=id,balance,due_date,created_at&student_id=eq.${studentId}&balance=gt.0&order=due_date.asc.nullsfirst,created_at.asc`
  );
  if (!dues.length) { studentsWithNoOpenDues++; leftoverTotal += list.reduce((t, p) => t + p.remaining, 0); continue; }

  let di = 0;
  for (const p of list) {
    let remaining = p.remaining;
    while (remaining > 0.009 && di < dues.length) {
      const due = dues[di];
      if (due.balance <= 0.009) { di++; continue; }
      const take = Math.min(remaining, due.balance);
      toInsert.push({ payment_id: p.id, invoice_id: due.id, school_id: schoolId, amount: Math.round(take * 100) / 100 });
      due.balance -= take;
      remaining -= take;
      if (due.balance <= 0.009) di++;
    }
    if (remaining <= 0.009) fullyCovered++;
    leftoverTotal += Math.max(0, remaining);
  }
}

console.log(`\nAllocation rows to write: ${toInsert.length}`);
console.log(`Payments fully covered by open dues: ${fullyCovered} / ${pending.length}`);
console.log(`Students with no open dues at all (their payments stay unlinked, as credit): ${studentsWithNoOpenDues}`);
console.log(`Total amount with no matching open due (stays as unallocated credit): ₹${leftoverTotal.toFixed(2)}`);

if (!write) {
  console.log("\nDry run (no --write passed). Sample of allocations that would be written:");
  console.log(JSON.stringify(toInsert.slice(0, 5), null, 2));
  console.log(`\nRe-run with --write to actually insert ${toInsert.length} allocation rows.`);
  process.exit(0);
}

console.log(`\nWriting ${toInsert.length} allocation rows...`);
const BATCH = 500;
let done = 0;
for (let i = 0; i < toInsert.length; i += BATCH) {
  const batch = toInsert.slice(i, i + BATCH);
  await sb("fee_allocations", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify(batch) });
  done += batch.length;
  console.log(`  ${done} / ${toInsert.length}`);
}
console.log("Done.");
