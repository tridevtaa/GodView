#!/usr/bin/env node
// One-off: build a minimal "Student Data" import file (the format GodView's
// own Students -> Import expects) for the MIS2026-27xxx admission series
// that fee-payments-reconcile.mjs found with no matching student. No
// Supabase access needed -- just reads the fee file.
//
//   node scripts/new-admissions-template.mjs "C:/path/to/2026-27 FEE RECEIVING DATA.xlsx"
//
// Writes new-admissions-2026-27.xlsx next to the input file. Registration
// Number / Student Name / Course are filled in; everything else (DOB,
// parent info, etc.) is left blank for you to add in Excel if you have it
// -- optional, not required for the import to work.

import * as XLSX from "../frontend/node_modules/xlsx/xlsx.mjs";
import * as fs from "node:fs";
import * as path from "node:path";
XLSX.set_fs(fs);

const filePath = process.argv[2];
if (!filePath) throw new Error('Usage: node scripts/new-admissions-template.mjs "<xlsx path>"');

const wb = XLSX.readFile(filePath);
const ws = wb.Sheets[wb.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
const header = rows[11];
const idx = (name) => header.indexOf(name);
const col = { reg: idx("RegNo"), name: idx("Student Name"), klass: idx("Class") };
const data = rows.slice(12).filter((r) => typeof r[0] === "number" && r[1]);

const byReg = new Map();
for (const r of data) {
  const reg = String(r[col.reg]).trim();
  if (!/^MIS2026-27/.test(reg)) continue; // only the unmatched admission series
  if (!byReg.has(reg)) byReg.set(reg, { reg, name: String(r[col.name]).trim(), klass: String(r[col.klass]).trim() });
}

const out = [...byReg.values()].sort((a, b) => a.reg.localeCompare(b.reg));
console.log(`Found ${out.length} new-admission RegNos.`);

const sheetRows = out.map((s) => ({
  "Registration Number": s.reg,
  "Student Name": s.name,
  "Course": s.klass,
}));
const outWb = XLSX.utils.book_new();
const outWs = XLSX.utils.json_to_sheet(sheetRows);
XLSX.utils.book_append_sheet(outWb, outWs, "Students");

const outPath = path.join(path.dirname(filePath), "new-admissions-2026-27.xlsx");
XLSX.writeFile(outWb, outPath);
console.log(`Written: ${outPath}`);
console.log("Open it in Excel, add any other details you have (optional), then use it in GodView's Students -> Import.");
