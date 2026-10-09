#!/usr/bin/env node
// One-off: copy a school's data from Firestore (godview-25fed) to Supabase.
//
//   SUPABASE_SECRET_KEY=... node scripts/migrate-firestore-to-supabase.mjs \
//     --school mavericks [--roster-2025-26 path/to/rows.json] [--dry-run]
//
// Reads Firestore with the Firebase CLI login on this machine (run
// `npx firebase-tools login` first) and writes to Supabase with the project's
// secret key, which bypasses Row Level Security. Never commit or share the key.
//
// Safe to re-run: students upsert on (school_id, admission_no), enrolments and
// fee dues on (student_id, session_id), photos overwrite the same path.

import fs from "fs";
import os from "os";
import { studentId } from "../frontend/src/data/studentImport.js";

const SUPABASE_URL = "https://zvnsbuviuogrnquwkbsa.supabase.co";
const FIREBASE_PROJECT = "godview-25fed";
const CURRENT_SESSION = "2026-27";

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const dry = flag("--dry-run");
const slug = opt("--school");
const rosterPath = opt("--roster-2025-26");
const key = process.env.SUPABASE_SECRET_KEY;
if (!slug) throw new Error("--school <slug> is required");
if (!key) throw new Error("Set SUPABASE_SECRET_KEY in the environment (Project Settings → API Keys → secret).");

// ------------------------------------------------------------ Firestore ---

const fbToken = JSON.parse(fs.readFileSync(`${os.homedir()}/.config/configstore/firebase-tools.json`, "utf8")).tokens
  .access_token;
const FS = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents`;

function fromValue(v) {
  if ("stringValue" in v) return v.stringValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return v.doubleValue;
  if ("booleanValue" in v) return v.booleanValue;
  if ("timestampValue" in v) return v.timestampValue;
  if ("nullValue" in v) return null;
  if ("arrayValue" in v) return (v.arrayValue.values ?? []).map(fromValue);
  if ("mapValue" in v) return fromFields(v.mapValue.fields ?? {});
  return undefined;
}
const fromFields = (f) => Object.fromEntries(Object.entries(f).map(([k, v]) => [k, fromValue(v)]));

async function listCollection(name) {
  const out = [];
  let pageToken = "";
  do {
    const res = await fetch(`${FS}/${name}?pageSize=300${pageToken ? `&pageToken=${pageToken}` : ""}`, {
      headers: { Authorization: `Bearer ${fbToken}` },
    });
    const json = await res.json();
    if (!res.ok) throw new Error(`Firestore ${name}: ${json.error?.status} ${json.error?.message}`);
    for (const d of json.documents ?? []) out.push({ id: d.name.split("/").pop(), ...fromFields(d.fields ?? {}) });
    pageToken = json.nextPageToken ?? "";
  } while (pageToken);
  return out;
}

// ------------------------------------------------------------- Supabase ---

const sbHeaders = { apikey: key, "Content-Type": "application/json" };
if (key.startsWith("eyJ")) sbHeaders.Authorization = `Bearer ${key}`; // legacy service_role JWT

async function sb(path, { method = "GET", body, prefer } = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: { ...sbHeaders, ...(prefer ? { Prefer: prefer } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Supabase ${method} ${path}: ${res.status} ${text}`);
  return text ? JSON.parse(text) : null;
}

async function upsert(table, rows, onConflict, select = "") {
  const out = [];
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const res = await sb(`${table}?on_conflict=${onConflict}${select ? `&select=${select}` : ""}`, {
      method: "POST",
      body: chunk,
      prefer: `resolution=merge-duplicates,return=${select ? "representation" : "minimal"}`,
    });
    if (res) out.push(...res);
  }
  return out;
}

async function uploadPhoto(path, dataUrl) {
  const [, b64] = dataUrl.split(",", 2);
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/photos/${path}`, {
    method: "POST",
    headers: { ...sbHeaders, "Content-Type": "image/jpeg", "x-upsert": "true" },
    body: Buffer.from(b64, "base64"),
  });
  if (!res.ok) throw new Error(`photo ${path}: ${res.status} ${await res.text()}`);
}

// ------------------------------------------------------------ transform ---

const text = (v) => (v === undefined || v === null ? null : String(v).trim() || null);
const isoDate = (v) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
const last4 = (v) => {
  const digits = String(v ?? "").replace(/\D/g, "");
  return digits.length >= 4 && !/^0+$/.test(digits) ? digits.slice(-4) : null;
};
const status = (v) => (["active", "inactive", "left"].includes(v) ? v : "active");

function studentRow(schoolId, d) {
  return {
    school_id: schoolId,
    admission_no: d.admission_no,
    name: d.name,
    gender: ["F", "M"].includes(d.gender) ? d.gender : "",
    dob: isoDate(d.dob),
    father_name: text(d.parent_name),
    mother_name: text(d.mother_name),
    parent_phone: text(d.parent_phone),
    father_phone: text(d.father_phone),
    mother_phone: text(d.mother_phone),
    email: text(d.email),
    address: text(d.address),
    city: text(d.city),
    state: text(d.state),
    category: text(d.category),
    religion: text(d.religion),
    srn: text(d.srn),
    aadhaar_last4: last4(d.aadhaar),
    admission_date: isoDate(d.admission_date),
    admission_type: text(d.admission_type),
    admission_category: text(d.admission_category),
    pickup_point: text(d.pickup_point),
    transport_route: text(d.transport_route),
    remarks: text(d.remarks),
    status: status(d.status),
    left_on: isoDate(d.left_as_of),
    photo_url: text(d.photo_url),
    legacy_id: d.id,
    updated_by: "migration",
  };
}

// --------------------------------------------------------------- run ---

const [school] = await sb(`schools?slug=eq.${slug}&select=id,name`);
if (!school) throw new Error(`No school with slug "${slug}" in Supabase — create it first.`);
const sessions = await sb(`academic_sessions?school_id=eq.${school.id}&select=id,name`);
const sessionId = Object.fromEntries(sessions.map((s) => [s.name, s.id]));
for (const s of ["2025-26", CURRENT_SESSION]) if (!sessionId[s]) throw new Error(`Session ${s} missing for ${slug}`);
console.log(`School: ${school.name} | sessions: ${sessions.map((s) => s.name).join(", ")}`);

const students = (await listCollection("students")).filter((d) => d.admission_no && d.name);
const employees = await listCollection("employees");
const photos = await listCollection("photos");
console.log(`Firestore: ${students.length} students, ${employees.length} employees, ${photos.length} photos`);

// 2025-26 class list for students who carried over (their Firestore record now
// holds 2026-27). Rows from the parsed "Export Data Report" PDF.
const roster2025 = new Map();
if (rosterPath) {
  for (const r of JSON.parse(fs.readFileSync(rosterPath, "utf8"))) {
    roster2025.set(studentId(r.reg), {
      class: r.course.replace(/^Class\s+/i, ""),
      stream: r.stream !== r.course ? r.stream : null,
      section: text(r.section),
      roll_no: text(r.roll),
    });
  }
}

const enrolments = []; // { legacy_id, session, class, section, stream, roll_no, status }
const dues = []; // { legacy_id, session, ...fee }
for (const d of students) {
  const session = d.session === "2025-26" ? "2025-26" : CURRENT_SESSION;
  enrolments.push({
    legacy_id: d.id,
    session,
    class: text(d.class) ?? "",
    section: text(d.section),
    stream: text(d.stream),
    roll_no: text(d.roll_no),
    // Someone who left was still on the roll in the session recorded for them.
    status: d.status === "left" ? "active" : status(d.status),
  });
  if (session === CURRENT_SESSION && roster2025.has(d.id)) {
    enrolments.push({ legacy_id: d.id, session: "2025-26", status: "active", ...roster2025.get(d.id) });
  }
  if (d.fee_status && d.fee_status !== "unknown") {
    dues.push({
      legacy_id: d.id,
      session,
      status: d.fee_status,
      amount: Number(d.fee_due) || 0,
      months: d.fee_due_months ?? [],
      breakdown: d.fee_breakdown ?? {},
      as_of: isoDate(d.fee_as_of) ?? "2026-10-08",
    });
  }
}
const bySession = (rows, s) => rows.filter((r) => r.session === s).length;
console.log(
  `Plan: ${students.length} students | enrolments 2025-26: ${bySession(enrolments, "2025-26")}, ` +
    `${CURRENT_SESSION}: ${bySession(enrolments, CURRENT_SESSION)} | fee dues: ${dues.length} | ` +
    `aadhaar kept as last 4: ${students.filter((d) => last4(d.aadhaar)).length} | photos: ${photos.length}`
);
if (dry) process.exit(0);

const saved = await upsert(
  "students",
  students.map((d) => studentRow(school.id, d)),
  "school_id,admission_no",
  "id,legacy_id"
);
const idFor = Object.fromEntries(saved.map((s) => [s.legacy_id, s.id]));
console.log(`students upserted: ${saved.length}`);

await upsert(
  "student_enrolments",
  enrolments.map(({ legacy_id, session, ...e }) => ({
    student_id: idFor[legacy_id],
    session_id: sessionId[session],
    school_id: school.id,
    ...e,
    updated_by: "migration",
  })),
  "student_id,session_id"
);
console.log(`enrolments upserted: ${enrolments.length}`);

if (dues.length) {
  await upsert(
    "fee_dues",
    dues.map(({ legacy_id, session, ...f }) => ({
      student_id: idFor[legacy_id],
      session_id: sessionId[session],
      school_id: school.id,
      ...f,
      updated_by: "migration",
    })),
    "student_id,session_id"
  );
}
console.log(`fee dues upserted: ${dues.length}`);

let uploaded = 0;
for (const p of photos) {
  const [kind, ...rest] = p.id.split("-");
  if (kind !== "students" || !p.data?.startsWith("data:image/")) continue;
  const uuid = idFor[rest.join("-")];
  if (!uuid) continue;
  const path = `${school.id}/students/${uuid}.jpg`;
  await uploadPhoto(path, p.data);
  await sb(`students?id=eq.${uuid}`, { method: "PATCH", body: { photo_path: path, updated_by: "migration" } });
  uploaded++;
}
console.log(`photos moved: ${uploaded}`);

if (employees.length) {
  await upsert(
    "employees",
    employees.map((e) => ({
      school_id: school.id,
      employee_no: text(e.employee_no),
      name: e.name,
      designation: text(e.designation),
      department: text(e.department),
      phone: text(e.phone),
      email: text(e.email),
      joining_date: isoDate(e.joining_date),
      legacy_id: e.id,
      updated_by: "migration",
    })),
    "school_id,employee_no"
  );
}
console.log(`employees upserted: ${employees.length}`);

const [{ count } = {}] = await sb(`students?school_id=eq.${school.id}&select=count`);
console.log(`Done. Students in Supabase for ${slug}: ${count}`);
