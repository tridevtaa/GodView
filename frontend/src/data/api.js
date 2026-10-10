import { supabase } from "../supabase.js";
import { clean, splitFields, toPerson } from "./personMapping.js";

// Supabase access for the app. Screens work with "person" objects whose field
// names predate the database (parent_name, aadhaar, fee_due…); this module maps
// between those and the tables in supabase/migrations.
//
// Row Level Security does the access control: every query here is limited to
// schools the signed-in user is a member of, whatever filters we pass.

const PAGE = 1000; // PostgREST returns at most this many rows per request

async function all(build) {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build().range(from, from + PAGE - 1);
    if (error) throw error;
    rows.push(...data);
    if (data.length < PAGE) return rows;
  }
}

const must = ({ data, error }) => {
  if (error) throw error;
  return data;
};

// -------------------------------------------------------------- reading ---

export async function listMemberships(email) {
  const rows = must(
    await supabase
      .from("school_members")
      .select("role, full_name, school:schools(*)")
      .eq("email", email.toLowerCase())
  );
  return rows.filter((r) => r.school);
}

// Newest first.
export async function listSessions(schoolId) {
  return must(
    await supabase.from("academic_sessions").select("id, name, starts_on, ends_on").eq("school_id", schoolId)
  ).sort((a, b) => b.name.localeCompare(a.name));
}

// Students enrolled in a session, with that session's class and fee dues.
export async function loadStudents(schoolId, sessionId) {
  const [enrolments, dues] = await Promise.all([
    all(() =>
      supabase
        .from("student_enrolments")
        .select("class, section, stream, roll_no, status, student:students(*, private:student_private(*))")
        .eq("school_id", schoolId)
        .eq("session_id", sessionId)
        .order("student_id")
    ),
    // Fee totals: owners/admins (and parents) get rows; teachers get none.
    // Optional: if fees can't be read, students still load (fees show as
    // not recorded) rather than the whole list failing.
    all(() =>
      supabase
        .from("fee_student_totals")
        .select("student_id, billed, paid, balance, due_now, next_due_date")
        .eq("school_id", schoolId)
        .eq("session_id", sessionId)
        .order("student_id")
    ).catch(() => []),
  ]);
  const duesBy = new Map(dues.map((d) => [d.student_id, d]));
  return enrolments.filter((e) => e.student).map((e) => toPerson(e.student, e, duesBy.get(e.student.id)));
}

export async function loadEmployees(schoolId) {
  return all(() => supabase.from("employees").select("*").eq("school_id", schoolId).order("name"));
}

// ------------------------------------------------------------- writing ---

async function savePrivate(schoolId, rows) {
  const filled = rows.filter((r) => Object.keys(r).length > 2); // more than the two ids
  if (filled.length) must(await supabase.from("student_private").upsert(filled, { onConflict: "student_id" }));
}

export async function addStudent(schoolId, sessionId, fields) {
  const { student, private: priv, enrolment } = splitFields(fields);
  const saved = must(
    await supabase.from("students").insert({ ...student, school_id: schoolId }).select().single()
  );
  await savePrivate(schoolId, [{ student_id: saved.id, school_id: schoolId, ...priv }]);
  const enrol = { student_id: saved.id, session_id: sessionId, school_id: schoolId, class: "", ...enrolment };
  must(await supabase.from("student_enrolments").insert(enrol));
  return toPerson({ ...saved, private: priv }, enrol);
}

export async function updateStudent(person, sessionId, changes) {
  const { student, private: priv, enrolment } = splitFields(changes);
  if (enrolment.status) {
    student.status = enrolment.status;
    student.left_on = enrolment.status === "left" ? new Date().toISOString().slice(0, 10) : null;
  }
  if (Object.keys(student).length) {
    must(await supabase.from("students").update(student).eq("id", person.id));
  }
  await savePrivate(person.school_id, [{ student_id: person.id, school_id: person.school_id, ...priv }]);
  if (Object.keys(enrolment).length) {
    must(
      await supabase.from("student_enrolments").update(enrolment).eq("student_id", person.id).eq("session_id", sessionId)
    );
  }
  // Same shape as the person on screen (keeps fees and photo_src).
  return { ...person, ...changes, ...(enrolment.status ? { left_as_of: student.left_on } : {}) };
}

export async function addEmployee(schoolId, fields) {
  const row = Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, clean(k, v)]));
  return must(await supabase.from("employees").insert({ ...row, school_id: schoolId }).select().single());
}

export async function updateEmployee(person, changes) {
  const row = Object.fromEntries(Object.entries(changes).map(([k, v]) => [k, clean(k, v)]));
  must(await supabase.from("employees").update(row).eq("id", person.id));
  return { ...person, ...row };
}

// Finds or creates a session by name ("2026-27"); creating needs an admin.
export async function ensureSession(schoolId, name) {
  const existing = must(
    await supabase.from("academic_sessions").select("id").eq("school_id", schoolId).eq("name", name).maybeSingle()
  );
  if (existing) return existing.id;
  const [start] = name.split("-");
  return must(
    await supabase
      .from("academic_sessions")
      .insert({ school_id: schoolId, name, starts_on: `${start}-04-01`, ends_on: `${Number(start) + 1}-03-31` })
      .select("id")
      .single()
  ).id;
}

// Writes an import plan from studentImport.planImport. `upserts` carry
// person-shaped data keyed by admission number; `leaving` lists admission
// numbers of students not in the file. Calls onProgress(done, total).
export async function applyImport(schoolId, sessionName, { upserts, leaving }, onProgress = () => {}) {
  const sessionId = await ensureSession(schoolId, sessionName);
  const total = upserts.length + leaving.length;
  let done = 0;

  for (let i = 0; i < upserts.length; i += 500) {
    const chunk = upserts.slice(i, i + 500).map(({ data }) => splitFields(data));
    const saved = must(
      await supabase
        .from("students")
        .upsert(
          chunk.map(({ student }) => ({ ...student, school_id: schoolId })),
          { onConflict: "school_id,admission_no" }
        )
        .select("id, admission_no")
    );
    const idByAdmission = new Map(saved.map((s) => [s.admission_no, s.id]));
    await savePrivate(
      schoolId,
      chunk.map(({ student, private: priv }) => ({
        student_id: idByAdmission.get(student.admission_no),
        school_id: schoolId,
        ...priv,
      }))
    );
    must(
      await supabase.from("student_enrolments").upsert(
        chunk.map(({ student, enrolment }) => ({
          student_id: idByAdmission.get(student.admission_no),
          session_id: sessionId,
          school_id: schoolId,
          class: "",
          ...enrolment,
        })),
        { onConflict: "student_id,session_id" }
      )
    );
    done += chunk.length;
    onProgress(done, total);
  }

  if (leaving.length) {
    const today = new Date().toISOString().slice(0, 10);
    for (let i = 0; i < leaving.length; i += 200) {
      const ids = leaving.slice(i, i + 200).map((l) => l.id);
      must(await supabase.from("students").update({ status: "left", left_on: today }).in("id", ids));
      must(
        await supabase.from("student_enrolments").update({ status: "left" }).in("student_id", ids).eq("session_id", sessionId)
      );
      done += ids.length;
      onProgress(done, total);
    }
  }
  return sessionId;
}

// --------------------------------------------------------------- photos ---

const BUCKET = "photos";
const SIGNED_FOR = 60 * 60 * 12; // seconds

// Adds `photo_src` (a temporary signed URL) to people with an uploaded photo.
export async function withPhotoUrls(people) {
  const paths = [...new Set(people.map((p) => p.photo_path).filter(Boolean))];
  if (!paths.length) return people;
  const urls = new Map();
  for (let i = 0; i < paths.length; i += 500) {
    const signed = must(await supabase.storage.from(BUCKET).createSignedUrls(paths.slice(i, i + 500), SIGNED_FOR));
    signed.forEach((s) => s.signedUrl && urls.set(s.path, s.signedUrl));
  }
  return people.map((p) => (p.photo_path && urls.has(p.photo_path) ? { ...p, photo_src: urls.get(p.photo_path) } : p));
}

// Uploads a JPEG blob as the person's photo; returns the fields to update.
export async function uploadPhoto(schoolId, kind, person, blob) {
  const path = `${schoolId}/${kind}/${person.id}.jpg`;
  // The file keeps its .jpg name (the database expects it); the content type
  // says what it really is (WebP or JPEG).
  const { error } = await supabase.storage.from(BUCKET).upload(path, blob, { upsert: true, contentType: blob.type || "image/jpeg" });
  if (error) throw error;
  // Students go through set_student_photo so their teachers can change photos
  // without update rights on the rest of the record.
  if (kind === "students") must(await supabase.rpc("set_student_photo", { student: person.id, path }));
  else must(await supabase.from(kind).update({ photo_path: path }).eq("id", person.id));
  const { signedUrl } = must(await supabase.storage.from(BUCKET).createSignedUrl(path, SIGNED_FOR));
  // Drop the device's stored copy of the old photo so the new one shows.
  try {
    const u = new URL(signedUrl);
    await (await caches.open("godview-photos-v1")).delete(u.origin + u.pathname);
  } catch {
    // No cache storage here (e.g. a private window): nothing to drop.
  }
  return { photo_path: path, photo_src: signedUrl };
}

// ------------------------------------------------------ notes & results ---

export async function listNotes(studentId) {
  return must(
    await supabase.from("student_notes").select("*").eq("student_id", studentId).order("created_at", { ascending: false })
  );
}

export async function addNote(schoolId, studentId, body, shared = false) {
  return must(
    await supabase
      .from("student_notes")
      .insert({ school_id: schoolId, student_id: studentId, body, shared_with_parents: shared })
      .select()
      .single()
  );
}

export async function deleteNote(id) {
  must(await supabase.from("student_notes").delete().eq("id", id));
}

export async function listResults(studentId, sessionId) {
  return must(
    await supabase
      .from("exam_results")
      .select("*")
      .eq("student_id", studentId)
      .eq("session_id", sessionId)
      .order("exam")
      .order("subject")
  );
}

// Adds or replaces the mark for one exam + subject.
export async function saveResult(schoolId, sessionId, studentId, { exam, subject, marks, max_marks, grade, remarks }) {
  const num = (v) => (v === "" || v === null || v === undefined ? null : Number(v));
  return must(
    await supabase
      .from("exam_results")
      .upsert(
        {
          school_id: schoolId,
          session_id: sessionId,
          student_id: studentId,
          exam: exam.trim(),
          subject: subject.trim(),
          marks: num(marks),
          max_marks: num(max_marks),
          grade: grade?.trim() || null,
          remarks: remarks?.trim() || null,
        },
        { onConflict: "student_id,session_id,exam,subject" }
      )
      .select()
      .single()
  );
}

export async function deleteResult(id) {
  must(await supabase.from("exam_results").delete().eq("id", id));
}

// ----------------------------------------------------- team (owner only) ---

export async function listMembers(schoolId) {
  return must(await supabase.from("school_members").select("*").eq("school_id", schoolId).order("email"));
}

export async function addMember(schoolId, email, role, details = {}) {
  const clean = Object.fromEntries(Object.entries(details).map(([k, v]) => [k, v?.trim() || null]));
  must(
    await supabase
      .from("school_members")
      .insert({ school_id: schoolId, email: email.trim().toLowerCase(), role, ...clean })
  );
}

export async function setMemberRole(schoolId, email, role) {
  must(await supabase.from("school_members").update({ role }).eq("school_id", schoolId).eq("email", email));
}

export async function removeMember(schoolId, email) {
  must(await supabase.from("school_members").delete().eq("school_id", schoolId).eq("email", email));
}

export async function listAssignments(schoolId) {
  return must(await supabase.from("teacher_classes").select("*").eq("school_id", schoolId).order("class"));
}

export async function addAssignment(schoolId, sessionId, email, klass, section) {
  return must(
    await supabase
      .from("teacher_classes")
      .insert({ school_id: schoolId, session_id: sessionId, email, class: klass, section: section || null })
      .select()
      .single()
  );
}

export async function removeAssignment(id) {
  must(await supabase.from("teacher_classes").delete().eq("id", id));
}

// ------------------------------------------------------ access requests ---

// School name, current session and class list for a join code; null if unknown.
export async function lookupJoinCode(code) {
  const rows = must(await supabase.rpc("lookup_join_code", { code }));
  return rows?.[0] ?? null;
}

// Photo for a join request, saved before the person is a member: only they
// can write it; the owner and admins of a school they ask to join can see it.
export async function uploadJoinPhoto(blob) {
  const { data } = await supabase.auth.getUser();
  if (!data?.user) throw new Error("not-signed-in");
  const path = `requests/${data.user.id}.jpg`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, blob, { upsert: true, contentType: blob.type || "image/jpeg" });
  if (error) throw error;
  return path;
}

export async function requestAccess(code, { fullName, designation, phone, subjects, note, classes, photoPath }) {
  must(
    await supabase.rpc("request_access", {
      p_code: code,
      p_full_name: fullName,
      p_designation: designation,
      p_phone: phone,
      p_subjects: subjects,
      p_note: note,
      p_classes: classes,
      p_photo_path: photoPath,
    })
  );
}

export async function listAccessRequests(schoolId) {
  return must(
    await supabase
      .from("access_requests")
      .select("*")
      .eq("school_id", schoolId)
      .eq("status", "pending")
      .order("created_at")
  );
}

// Approve: member + class assignments in one transaction (owner only).
export async function approveAccessRequest(id, role, classes) {
  must(await supabase.rpc("approve_access_request", { request: id, as_role: role, classes }));
}

export async function rejectAccessRequest(id, decidedBy) {
  must(
    await supabase
      .from("access_requests")
      .update({ status: "rejected", decided_by: decidedBy, decided_at: new Date().toISOString() })
      .eq("id", id)
  );
}

export async function regenerateJoinCode(schoolId) {
  return must(await supabase.rpc("regenerate_join_code", { school: schoolId }));
}

export async function updateMemberDetails(schoolId, email, details) {
  must(await supabase.from("school_members").update(details).eq("school_id", schoolId).eq("email", email));
}

// ------------------------------------------------------ export requests ---

export async function listExportRequests(schoolId) {
  return must(
    await supabase.from("export_requests").select("*").eq("school_id", schoolId).order("created_at", { ascending: false })
  );
}

export async function requestExport(schoolId, reason) {
  return must(await supabase.from("export_requests").insert({ school_id: schoolId, reason }).select().single());
}

export async function decideExport(id, approve, decidedBy) {
  must(
    await supabase
      .from("export_requests")
      .update({ status: approve ? "approved" : "rejected", decided_by: decidedBy, decided_at: new Date().toISOString() })
      .eq("id", id)
  );
}

// Consumes an approved request; true if the export may go ahead.
export async function consumeExportRequest(id) {
  return must(await supabase.rpc("use_export_request", { request: id }));
}

// Distinct class/section pairs enrolled in a session, for assignment pickers.
export async function listClassSections(schoolId, sessionId) {
  const rows = await all(() =>
    supabase
      .from("student_enrolments")
      .select("class, section")
      .eq("school_id", schoolId)
      .eq("session_id", sessionId)
      .order("student_id")
  );
  const seen = new Map();
  rows.forEach((r) => seen.set(`${r.class}|${r.section ?? ""}`, { class: r.class, section: r.section ?? "" }));
  return [...seen.values()];
}

// Pending access + export requests, for the owner's Team badge.
export async function countPendingRequests(schoolId) {
  const [a, x] = await Promise.all([
    supabase.from("access_requests").select("id", { count: "exact", head: true }).eq("school_id", schoolId).eq("status", "pending"),
    supabase.from("export_requests").select("id", { count: "exact", head: true }).eq("school_id", schoolId).eq("status", "pending"),
  ]);
  return (a.count ?? 0) + (x.count ?? 0);
}

// ------------------------------------------------------- school profile ---

const LOGOS = "school-logos";

export const logoUrl = (path) => (path ? supabase.storage.from(LOGOS).getPublicUrl(path).data.publicUrl : "");

export const SCHOOL_FIELDS = [
  "name", "short_name", "board", "affiliation_no", "udise_code", "principal_name",
  "address", "city", "state", "pincode", "phone", "email", "website",
];

// Owner only (enforced by RLS and column grants). Returns the saved school.
export async function updateSchool(schoolId, fields) {
  const row = Object.fromEntries(
    SCHOOL_FIELDS.filter((k) => k in fields).map((k) => [k, fields[k]?.trim?.() || (k === "name" ? fields[k] : null)])
  );
  return must(await supabase.from("schools").update(row).eq("id", schoolId).select().single());
}

// Any image (incl. SVG) → PNG no larger than 512px, transparent background kept.
async function toLogoPng(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = url;
    });
    const w = img.naturalWidth || 512;
    const h = img.naturalHeight || 512;
    const scale = Math.min(1, 512 / Math.max(w, h));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
    return await new Promise((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("encode-failed"))), "image/png")
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Uploads a new logo (new file name each time so browsers don't show a stale
// copy) and points the school at it. Returns the saved school.
export async function uploadSchoolLogo(school, file) {
  if (!file.type.startsWith("image/")) throw new Error("not-an-image");
  const path = `${school.id}/logo-${Date.now()}.png`;
  const { error } = await supabase.storage.from(LOGOS).upload(path, await toLogoPng(file), { contentType: "image/png" });
  if (error) throw error;
  const saved = must(await supabase.from("schools").update({ logo_path: path }).eq("id", school.id).select().single());
  if (school.logo_path) await supabase.storage.from(LOGOS).remove([school.logo_path]); // best effort
  return saved;
}

export async function removeSchoolLogo(school) {
  const saved = must(await supabase.from("schools").update({ logo_path: null }).eq("id", school.id).select().single());
  if (school.logo_path) await supabase.storage.from(LOGOS).remove([school.logo_path]);
  return saved;
}

// The signed-in person's own join requests (newest first), with school name/logo.
export async function myAccessRequests() {
  return must(await supabase.rpc("my_access_requests"));
}

// ------------------------------------------------------------------ fees ---

export async function listFeeHeads(schoolId) {
  return must(await supabase.from("fee_heads").select("*").eq("school_id", schoolId).order("sort").order("name"));
}

export async function addFeeHead(schoolId, name) {
  return must(await supabase.from("fee_heads").insert({ school_id: schoolId, name: name.trim() }).select().single());
}

export async function ensureFeeHead(schoolId, name, heads) {
  const found = heads.find((h) => h.name.toLowerCase() === name.trim().toLowerCase());
  return found ?? (await addFeeHead(schoolId, name));
}

export async function deleteFeeHead(id) {
  must(await supabase.from("fee_heads").delete().eq("id", id));
}

export async function listSchedule(sessionId) {
  return must(await supabase.from("fee_schedule").select("*").eq("session_id", sessionId).order("created_at"));
}

export async function addScheduleLine(schoolId, sessionId, line) {
  return must(
    await supabase
      .from("fee_schedule")
      .insert({
        school_id: schoolId,
        session_id: sessionId,
        class: line.class || null,
        head_id: line.head_id,
        amount: Number(line.amount),
        frequency: line.frequency,
        start_month: Number(line.start_month) || 4,
        due_day: Number(line.due_day) || 10,
      })
      .select()
      .single()
  );
}

export async function deleteScheduleLine(id) {
  must(await supabase.from("fee_schedule").delete().eq("id", id));
}

export async function generateInvoices(sessionId) {
  return must(await supabase.rpc("generate_invoices", { session: sessionId }));
}

export async function feeSessionSummary(sessionId) {
  const rows = must(await supabase.rpc("fee_session_summary", { session: sessionId }));
  return rows?.[0] ?? null;
}

// Every due and payment for one student (all sessions), newest first.
export async function studentLedger(studentId) {
  const [dues, payments] = await Promise.all([
    all(() => supabase.from("fee_invoice_balances").select("*").eq("student_id", studentId).order("due_date")),
    all(() =>
      supabase
        .from("fee_payments")
        .select("*, allocations:fee_allocations(amount, invoice_id)")
        .eq("student_id", studentId)
        .order("paid_on", { ascending: false })
    ),
  ]);
  return { dues, payments };
}

export async function recordPayment(studentId, { amount, method, reference, paid_on, note }) {
  const rows = must(
    await supabase.rpc("record_payment", {
      p_student: studentId,
      p_amount: Number(amount),
      p_method: method,
      p_reference: reference || null,
      p_paid_on: paid_on || null,
      p_note: note || null,
    })
  );
  return rows?.[0];
}

export async function cancelPayment(id) {
  must(await supabase.rpc("cancel_payment", { payment: id }));
}

export async function setConcession(invoiceId, amount, note) {
  must(
    await supabase
      .from("fee_invoices")
      .update({ concession: Number(amount) || 0, note: note || null })
      .eq("id", invoiceId)
  );
}

// Opening balances from the old fee system: one due per fee head per
// student (period "opening"); re-importing updates the amounts.
export async function importOpeningBalances(schoolId, sessionId, rows) {
  const heads = await listFeeHeads(schoolId);
  const headId = new Map();
  for (const name of [...new Set(rows.map((r) => r.head))]) headId.set(name, (await ensureFeeHead(schoolId, name, heads)).id);
  const today = new Date().toISOString().slice(0, 10);
  const records = rows.map((r) => ({
    school_id: schoolId,
    session_id: sessionId,
    student_id: r.student_id,
    head_id: headId.get(r.head),
    period: "opening",
    label: "Opening balance",
    amount: r.amount,
    due_date: today,
  }));
  for (let i = 0; i < records.length; i += 500) {
    must(
      await supabase
        .from("fee_invoices")
        .upsert(records.slice(i, i + 500), { onConflict: "student_id,session_id,head_id,period" })
    );
  }
  return records.length;
}

// -------------------------------------------------------------- requests ---

export async function listRequests(schoolId, { status } = {}) {
  let q = supabase
    .from("parent_requests")
    .select("*, student:students(id, name, admission_no, photo_url, photo_path), guardian:guardians(name, phone)")
    .eq("school_id", schoolId)
    .order("created_at", { ascending: false })
    .limit(300);
  if (status === "open") q = q.eq("status", "open");
  return must(await q);
}

export async function answerRequest(id, status, response, me) {
  must(
    await supabase
      .from("parent_requests")
      .update({ status, response: response?.trim() || null, handled_by: me, handled_at: new Date().toISOString() })
      .eq("id", id)
  );
}

export async function countOpenRequests(schoolId) {
  const { count } = await supabase
    .from("parent_requests")
    .select("id", { count: "exact", head: true })
    .eq("school_id", schoolId)
    .eq("status", "open");
  return count ?? 0;
}

// --------------------------------------------------------------- parents ---

export async function listGuardians(studentId) {
  return must(
    await supabase
      .from("guardian_students")
      .select("relation, source, removed, guardian:guardians(id, name, phone)")
      .eq("student_id", studentId)
      .eq("removed", false)
  );
}

export async function addGuardian(studentId, { phone, name, relation }) {
  must(
    await supabase.rpc("add_guardian", { p_student: studentId, p_phone: phone, p_name: name || null, p_relation: relation })
  );
}

export async function removeGuardianLink(guardianId, studentId) {
  must(
    await supabase.from("guardian_students").update({ removed: true }).eq("guardian_id", guardianId).eq("student_id", studentId)
  );
}

// ------------------------------------------------------------ note sharing ---

export async function setNoteShared(noteId, shared) {
  must(await supabase.from("student_notes").update({ shared_with_parents: shared }).eq("id", noteId));
}

// --------------------------------------------- grades & instalment types ---

export async function listGrades(schoolId) {
  return must(await supabase.from("school_grades").select("*").eq("school_id", schoolId).order("sort").order("code"));
}

export async function addGrade(schoolId, label, sort, code) {
  const name = label.trim();
  return must(
    await supabase
      .from("school_grades")
      .insert({ school_id: schoolId, code: (code ?? name).trim(), label: name, sort })
      .select()
      .single()
  );
}

export async function updateGrade(id, fields) {
  return must(await supabase.from("school_grades").update(fields).eq("id", id).select().single());
}

export async function listPlans(schoolId) {
  return must(await supabase.from("fee_plans").select("*").eq("school_id", schoolId).order("sort").order("name"));
}

export async function addPlan(schoolId, { name, months, due_day }) {
  return must(
    await supabase
      .from("fee_plans")
      .insert({ school_id: schoolId, name: name.trim(), months, due_day: Number(due_day) || 10, sort: 10 })
      .select()
      .single()
  );
}

export async function deletePlan(id) {
  must(await supabase.from("fee_plans").delete().eq("id", id));
}

// Sets one grade's amount and instalment type for a fee head (owner only).
// Clearing the amount removes that grade's line.
export async function setGradeFee(schoolId, sessionId, existing, { grade, headId, amount, planId, streams = null }) {
  const value = Number(amount);
  if (!value) {
    if (existing) must(await supabase.from("fee_schedule").delete().eq("id", existing.id));
    return null;
  }
  if (existing) {
    return must(
      await supabase
        .from("fee_schedule")
        .update({ amount: value, plan_id: planId, frequency: null })
        .eq("id", existing.id)
        .select()
        .single()
    );
  }
  return must(
    await supabase
      .from("fee_schedule")
      .insert({ school_id: schoolId, session_id: sessionId, class: grade, streams, head_id: headId, amount: value, plan_id: planId })
      .select()
      .single()
  );
}

export async function feeMonthlyCollection(sessionId) {
  return must(await supabase.rpc("fee_monthly_collection", { session: sessionId }));
}

export async function feeClassSummary(sessionId) {
  return must(await supabase.rpc("fee_class_summary", { session: sessionId }));
}

// Removes a fee from the structure (all grades). The fee name itself is
// kept if dues were already created with it.
export async function removeFeeFromStructure(sessionId, headId) {
  must(await supabase.from("fee_schedule").delete().eq("session_id", sessionId).eq("head_id", headId));
  await supabase.from("fee_heads").delete().eq("id", headId); // fails quietly if dues use it
}

export async function deleteGrade(id) {
  must(await supabase.from("school_grades").delete().eq("id", id));
}

export async function renameFeeHead(id, name) {
  must(await supabase.from("fee_heads").update({ name: name.trim() }).eq("id", id));
}

// ------------------------------------------------------------ transport ---

// Routes with their stops in order.
export async function listRoutes(schoolId) {
  const rows = must(
    await supabase.from("bus_routes").select("*, stops:bus_stops(*)").eq("school_id", schoolId).order("sort").order("name")
  );
  return rows.map((r) => ({ ...r, stops: [...(r.stops ?? [])].sort((a, b) => a.sort - b.sort || a.created_at.localeCompare(b.created_at)) }));
}

export async function addRoute(schoolId, name, sort) {
  return must(await supabase.from("bus_routes").insert({ school_id: schoolId, name: name.trim(), sort }).select().single());
}

export async function updateRoute(id, fields) {
  must(await supabase.from("bus_routes").update(fields).eq("id", id));
}

export async function deleteRoute(id) {
  must(await supabase.from("bus_routes").delete().eq("id", id));
}

export async function addStop(schoolId, routeId, { name, address, place_id, lat, lng }, sort) {
  return must(
    await supabase
      .from("bus_stops")
      .insert({ school_id: schoolId, route_id: routeId, name: name.trim(), address, place_id, lat, lng, sort })
      .select()
      .single()
  );
}

export async function updateStop(id, fields) {
  must(await supabase.from("bus_stops").update(fields).eq("id", id));
}

export async function deleteStop(id) {
  must(await supabase.from("bus_stops").delete().eq("id", id));
}

// ---------------------------------------------------- villages (areas) ---

export async function listAreas(schoolId) {
  return must(await supabase.from("school_areas").select("*").eq("school_id", schoolId).order("name"));
}

export async function addAreas(schoolId, rows) {
  if (!rows.length) return [];
  return must(
    await supabase
      .from("school_areas")
      .insert(rows.map((r) => ({ school_id: schoolId, name: r.name, aliases: r.aliases ?? [], lat: r.lat ?? null, lng: r.lng ?? null, source: r.source ?? null })))
      .select()
  );
}

export async function updateArea(id, fields) {
  must(await supabase.from("school_areas").update(fields).eq("id", id));
}

export async function deleteArea(id) {
  must(await supabase.from("school_areas").delete().eq("id", id));
}

// Folds `from` into `into`: its spellings and any students set to it.
export async function mergeAreas(into, from) {
  const aliases = [...new Set([...(into.aliases ?? []), ...(from.aliases ?? [])])].slice(0, 50);
  must(await supabase.from("school_areas").update({ aliases }).eq("id", into.id));
  must(await supabase.from("student_private").update({ area_id: into.id }).eq("area_id", from.id));
  must(await supabase.from("school_areas").delete().eq("id", from.id));
}

export async function setSchoolLocation(schoolId, lat, lng) {
  must(await supabase.rpc("set_school_location", { school: schoolId, lat, lng }));
}

// --------------------------------------------------------------- parents ---
// Parents sign in with their mobile number; the database only shows them
// their own children (and only notes the school chose to share).

const toIndian = (ten) => `+91${String(ten).replace(/\D/g, "").slice(-10)}`;

// Sends a sign-in code. Delivery is WhatsApp, through the Supabase Auth
// "Send SMS" hook; only numbers linked to a student get a message.
export async function sendParentCode(ten) {
  const { error } = await supabase.auth.signInWithOtp({ phone: toIndian(ten), options: { shouldCreateUser: true } });
  if (error) throw error;
}

export async function verifyParentCode(ten, token) {
  const { error } = await supabase.auth.verifyOtp({ phone: toIndian(ten), token: token.trim(), type: "sms" });
  if (error) throw error;
}

// The signed-in parent's children with their school, latest class and photo.
export async function parentFamily() {
  const kids = must(
    await supabase
      .from("students")
      .select("id, name, admission_no, photo_path, school_id, enrolments:student_enrolments(class, section, status, session:academic_sessions(id, name, starts_on, ends_on))")
      .order("name")
  );
  const schoolIds = [...new Set(kids.map((k) => k.school_id))];
  const schools = schoolIds.length
    ? must(await supabase.from("schools").select("id, name, short_name, logo_path, address, city, state, pincode, phone, email").in("id", schoolIds))
    : [];
  const bySchool = new Map(schools.map((s) => [s.id, s]));
  const children = kids.map((k) => {
    // The newest session they're enrolled in.
    const e = [...(k.enrolments ?? [])].sort((a, b) => String(b.session?.name).localeCompare(String(a.session?.name)))[0];
    return { ...k, class: e?.class ?? "", section: e?.section ?? "", session: e?.session ?? null, school: bySchool.get(k.school_id) };
  });
  return withPhotoUrls(children).catch(() => children);
}

export async function parentFees(studentId, schoolId) {
  const [{ dues, payments }, heads] = await Promise.all([
    studentLedger(studentId),
    supabase.from("fee_heads").select("id, name").eq("school_id", schoolId).then(must),
  ]);
  const name = new Map(heads.map((h) => [h.id, h.name]));
  return { dues: dues.map((d) => ({ ...d, head_name: name.get(d.head_id) })), payments };
}

export async function parentNotes(studentId) {
  return must(
    await supabase
      .from("student_notes")
      .select("id, body, created_at, updated_at")
      .eq("student_id", studentId)
      .eq("shared_with_parents", true)
      .order("created_at", { ascending: false })
  );
}

export async function parentRequests(studentId) {
  return must(
    await supabase.from("parent_requests").select("*").eq("student_id", studentId).order("created_at", { ascending: false })
  );
}

export async function createParentRequest(studentId, { kind, subject, body, leave_from, leave_to, certificate_type }) {
  return must(
    await supabase.rpc("create_request", {
      p_student: studentId,
      p_kind: kind,
      p_subject: subject,
      p_body: body || null,
      p_leave_from: leave_from || null,
      p_leave_to: leave_to || null,
      p_certificate_type: certificate_type || null,
    })
  );
}

export async function cancelParentRequest(id) {
  must(await supabase.rpc("cancel_request", { request: id }));
}

// Red dots: per child and section, how many things are new since the
// parent last looked, and when that was.
export async function parentUnread() {
  return must(await supabase.rpc("parent_unread"));
}

export async function markParentSeen(studentId, section) {
  must(await supabase.rpc("mark_parent_seen", { student: studentId, p_section: section }));
}
