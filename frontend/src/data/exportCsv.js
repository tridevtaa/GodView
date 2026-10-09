// Builds a CSV of students and hands it to the browser as a download.

const COLUMNS = [
  ["Admission no.", "admission_no"], ["Name", "name"], ["Gender", "gender"], ["Date of birth", "dob"],
  ["Grade", "class"], ["Section", "section"], ["Stream", "stream"], ["Roll no.", "roll_no"], ["Status", "status"],
  ["Father", "parent_name"], ["Mother", "mother_name"], ["Parent phone", "parent_phone"],
  ["Father phone", "father_phone"], ["Mother phone", "mother_phone"], ["Email", "email"], ["Address", "address"],
  ["City", "city"], ["State", "state"], ["Category", "category"], ["Religion", "religion"], ["SRN", "srn"],
  ["Aadhaar (last 4)", "aadhaar"], ["Admission date", "admission_date"], ["Admission type", "admission_type"],
  ["Pick-up point", "pickup_point"], ["Fee status", "fee_status"], ["Fee due", "fee_due"],
];

const cell = (v) => {
  const s = v === null || v === undefined ? "" : String(v);
  // Quote when needed; neutralise leading =,+,-,@ so spreadsheets don't run it as a formula.
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export function downloadStudentsCsv(people, filename) {
  const lines = [COLUMNS.map(([h]) => h).join(",")];
  for (const p of people) lines.push(COLUMNS.map(([, k]) => cell(p[k])).join(","));
  // BOM so Excel opens UTF-8 names correctly.
  const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement("a"), { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
