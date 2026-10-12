#!/usr/bin/env node
// One-off: import historical payment records from an old ERP's "Fee
// Receiving Data" export into fee_payments. These are history only: no
// fee_allocations are written, so they don't offset any currently-open
// GodView invoice/due (use "Bring in old balances" separately for that).
//
//   SUPABASE_SECRET_KEY=... node scripts/fee-payments-import.mjs \
//     "C:/path/to/2026-27 FEE RECEIVING DATA.xlsx" [--write]
//
// Without --write this only previews counts and samples; nothing is sent.
// The secret key bypasses Row Level Security for this write. Never commit
// or share it; it's only read from the environment.
//
// Safe to re-run: receipt_no is unique per school, so already-imported rows
// (prefixed "OLD-") are skipped on conflict rather than duplicated.

// No root node_modules in this repo; reuse the frontend's xlsx install.
import * as XLSX from "../frontend/node_modules/xlsx/xlsx.mjs";
import * as fs from "node:fs";
XLSX.set_fs(fs);

const SUPABASE_URL = "https://zvnsbuviuogrnquwkbsa.supabase.co";
const METHOD_MAP = { Cash: "cash", Online: "online", "Bank Transfer": "bank_transfer", Cheque: "cheque" };

const args = process.argv.slice(2);
const filePath = args.find((a) => !a.startsWith("--"));
const write = args.includes("--write");
const key = process.env.SUPABASE_SECRET_KEY;
if (!filePath) throw new Error('Usage: SUPABASE_SECRET_KEY=... node scripts/fee-payments-import.mjs "<xlsx path>" [--write]');
if (!key) throw new Error("Set SUPABASE_SECRET_KEY in the environment (Project Settings → API Keys → secret).");

// ------------------------------------------------------------- read xlsx ---

const wb = XLSX.readFile(filePath);
const ws = wb.Sheets[wb.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
const header = rows[11];
const idx = (name) => header.indexOf(name);
const data = rows.slice(12).filter((r) => typeof r[0] === "number" && r[1]);

const col = {
  receipt: idx("Receipt No."),
  date: idx("Date"),
  reg: idx("RegNo"),
  name: idx("Student Name"),
  mode: idx("Pay Mode"),
  ref: idx("Ref/ Chqno"),
  user: idx("User Name"),
  total: idx("Total Paid Amount"),
};
for (const [k, v] of Object.entries(col)) if (v < 0) throw new Error(`Column layout changed; missing "${k}".`);

// "12-Oct-2026" -> "2026-10-26"... actually -> "2026-10-12"
const MONTHS = { Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06", Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12" };
function isoDate(s) {
  const m = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/.exec(String(s).trim());
  if (!m) return null;
  const mon = MONTHS[m[2]];
  if (!mon) return null;
  return `${m[3]}-${mon}-${m[1].padStart(2, "0")}`;
}

const seenReceipts = new Set();
const ready = [];
const excluded = { adjusted: [], unmappedMode: [], zeroAmount: [], badDate: [], dupReceipt: [] };

for (const r of data) {
  const reg = String(r[col.reg]).trim();
  const mode = String(r[col.mode]).trim();
  const amount = Number(r[col.total]) || 0;
  // The old ERP has two parallel receipt-number series (regular fee receipts
  // and a separate admission series) that collide on plain numbers, so the
  // RegNo is folded in to keep these unique per school.
  const receipt = "OLD-" + String(r[col.receipt]).trim() + "-" + reg;
  const paid_on = isoDate(r[col.date]);

  if (mode === "Adjusted") { excluded.adjusted.push({ reg, receipt, amount }); continue; }
  if (!METHOD_MAP[mode]) { excluded.unmappedMode.push({ reg, receipt, mode }); continue; }
  if (amount <= 0) { excluded.zeroAmount.push({ reg, receipt, amount }); continue; }
  if (!paid_on) { excluded.badDate.push({ reg, receipt, raw: r[col.date] }); continue; }
  if (seenReceipts.has(receipt)) { excluded.dupReceipt.push({ reg, receipt }); continue; }
  seenReceipts.add(receipt);

  ready.push({
    reg,
    name: r[col.name],
    amount,
    method: METHOD_MAP[mode],
    reference: String(r[col.ref] ?? "").trim().slice(0, 80) || null,
    paid_on,
    receipt_no: receipt,
    received_by: String(r[col.user] ?? "").trim().slice(0, 120) || null,
    note: "Imported from old ERP export".slice(0, 300),
  });
}

console.log(`Ready to import: ${ready.length}`);
for (const [k, v] of Object.entries(excluded)) if (v.length) console.log(`Excluded (${k}): ${v.length}`);

// --------------------------------------------------------------- supabase --

async function sb(path, init = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

async function fetchAllStudents() {
  const out = [];
  let from = 0;
  const page = 1000;
  for (;;) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/students?select=id,school_id,admission_no`, {
      headers: { apikey: key, Authorization: `Bearer ${key}`, Range: `${from}-${from + page - 1}` },
    });
    if (!res.ok) throw new Error(`Supabase read failed: ${res.status} ${await res.text()}`);
    const batch = await res.json();
    out.push(...batch);
    if (batch.length < page) break;
    from += page;
  }
  return out;
}

const students = await fetchAllStudents();
const byAdm = new Map(students.map((s) => [String(s.admission_no).trim(), s]));

const toWrite = [];
const noStudent = [];
for (const r of ready) {
  const s = byAdm.get(r.reg);
  if (!s) { noStudent.push(r); continue; }
  toWrite.push({
    school_id: s.school_id,
    student_id: s.id,
    amount: r.amount,
    method: r.method,
    reference: r.reference,
    paid_on: r.paid_on,
    receipt_no: r.receipt_no,
    status: "success",
    received_by: r.received_by,
    note: r.note,
  });
}
console.log(`Matched to a student: ${toWrite.length}`);
console.log(`No matching student (already reported by the reconcile script): ${noStudent.length}`);

const schoolIds = new Set(toWrite.map((r) => r.school_id));
if (schoolIds.size > 1) throw new Error(`Matched students span ${schoolIds.size} schools; expected one. Aborting.`);

if (!write) {
  console.log("\nDry run (no --write passed). Sample of rows that would be inserted:");
  console.log(JSON.stringify(toWrite.slice(0, 5), null, 2));
  console.log(`\n${toWrite.length} rows total would be inserted. Re-run with --write to actually insert.`);
  process.exit(0);
}

console.log(`\nWriting ${toWrite.length} rows...`);
const BATCH = 500;
let inserted = 0;
for (let i = 0; i < toWrite.length; i += BATCH) {
  const batch = toWrite.slice(i, i + BATCH);
  // on_conflict + ignore-duplicates: re-running the script never double-inserts.
  await sb(`fee_payments?on_conflict=school_id,receipt_no`, {
    method: "POST",
    headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
    body: JSON.stringify(batch),
  });
  inserted += batch.length;
  console.log(`  ${inserted} / ${toWrite.length}`);
}
console.log("Done.");
