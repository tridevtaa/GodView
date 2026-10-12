#!/usr/bin/env node
// One-off, read-only: check how many RegNos in an old ERP's "Fee Receiving
// Data" export match students already in Supabase. Writes nothing.
//
//   SUPABASE_SECRET_KEY=... node scripts/fee-payments-reconcile.mjs \
//     "C:/path/to/2026-27 FEE RECEIVING DATA.xlsx"
//
// The secret key bypasses Row Level Security for this read. Never commit or
// share it; it's only read from the environment.

// No root node_modules in this repo; reuse the frontend's xlsx install.
import * as XLSX from "../frontend/node_modules/xlsx/xlsx.mjs";
import * as fs from "node:fs";
XLSX.set_fs(fs);

const SUPABASE_URL = "https://zvnsbuviuogrnquwkbsa.supabase.co";

const filePath = process.argv[2];
const key = process.env.SUPABASE_SECRET_KEY;
if (!filePath) throw new Error("Usage: SUPABASE_SECRET_KEY=... node scripts/fee-payments-reconcile.mjs <xlsx path>");
if (!key) throw new Error("Set SUPABASE_SECRET_KEY in the environment (Project Settings → API Keys → secret).");

// ------------------------------------------------------------- read xlsx ---

const wb = XLSX.readFile(filePath);
const ws = wb.Sheets[wb.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
const header = rows[11]; // row 12 (0-indexed 11) holds the real column names
const idx = (name) => header.indexOf(name);
// Real payment rows have a numeric S.No and a receipt number; the sheet also
// has a per-collector / per-fee-head summary block at the end with no S.No.
const data = rows.slice(12).filter((r) => typeof r[0] === "number" && r[1]);

const regIdx = idx("RegNo");
const nameIdx = idx("Student Name");
const totalIdx = idx("Total Paid Amount");
if (regIdx < 0 || nameIdx < 0 || totalIdx < 0) throw new Error("Column layout changed; expected RegNo / Student Name / Total Paid Amount at row 12.");

const byReg = new Map(); // regNo -> { name, count, sum }
for (const r of data) {
  const reg = String(r[regIdx]).trim();
  if (!reg) continue;
  const amt = Number(r[totalIdx]) || 0;
  const cur = byReg.get(reg) ?? { name: r[nameIdx], count: 0, sum: 0 };
  cur.count += 1;
  cur.sum += amt;
  byReg.set(reg, cur);
}
console.log(`File: ${data.length} payment rows, ${byReg.size} distinct RegNos.`);

// --------------------------------------------------------------- supabase --

async function fetchAllStudents() {
  const out = [];
  let from = 0;
  const page = 1000;
  for (;;) {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/students?select=id,admission_no,name,status&order=admission_no`,
      {
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          Range: `${from}-${from + page - 1}`,
        },
      }
    );
    if (!res.ok) throw new Error(`Supabase read failed: ${res.status} ${await res.text()}`);
    const batch = await res.json();
    out.push(...batch);
    if (batch.length < page) break;
    from += page;
  }
  return out;
}

const students = await fetchAllStudents();
console.log(`Database: ${students.length} students total.`);

const byAdm = new Map(students.map((s) => [String(s.admission_no).trim(), s]));

const matched = [];
const unmatched = [];
for (const [reg, info] of byReg) {
  const s = byAdm.get(reg);
  if (s) matched.push({ reg, ...info, dbName: s.name, status: s.status });
  else unmatched.push({ reg, ...info });
}

console.log(`\nMatched by admission_no: ${matched.length} / ${byReg.size}`);
console.log(`Unmatched: ${unmatched.length}`);

if (unmatched.length) {
  console.log("\nFirst 30 unmatched RegNos (file name -> no student with this admission_no):");
  for (const u of unmatched.slice(0, 30)) console.log(`  ${u.reg}\t${u.name}\t(${u.count} payment(s), ₹${u.sum})`);
  if (unmatched.length > 30) console.log(`  ...and ${unmatched.length - 30} more`);
}

const nameMismatches = matched.filter((m) => m.name && m.dbName && m.name.trim().toLowerCase() !== m.dbName.trim().toLowerCase());
if (nameMismatches.length) {
  console.log(`\n${nameMismatches.length} matched RegNos where the file's name differs from the database's name (check these aren't a different student reusing an old admission_no):`);
  for (const m of nameMismatches.slice(0, 20)) console.log(`  ${m.reg}\tfile: "${m.name}"\tdb: "${m.dbName}"`);
}

const totalAmount = [...byReg.values()].reduce((t, v) => t + v.sum, 0);
const matchedAmount = matched.reduce((t, v) => t + v.sum, 0);
console.log(`\nTotal in file: ₹${totalAmount}. Matched to a student: ₹${matchedAmount}. Unmatched: ₹${totalAmount - matchedAmount}.`);
