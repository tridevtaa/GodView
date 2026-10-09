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
      .select("role, full_name, school:schools(id, name, slug, join_code)")
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
    all(() => supabase.from("fee_dues").select("*").eq("school_id", schoolId).eq("session_id", sessionId).order("student_id")),
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
  const { error } = await supabase.storage.from(BUCKET).upload(path, blob, { upsert: true, contentType: "image/jpeg" });
  if (error) throw error;
  // Students go through set_student_photo so their teachers can change photos
  // without update rights on the rest of the record.
  if (kind === "students") must(await supabase.rpc("set_student_photo", { student: person.id, path }));
  else must(await supabase.from(kind).update({ photo_path: path }).eq("id", person.id));
  const { signedUrl } = must(await supabase.storage.from(BUCKET).createSignedUrl(path, SIGNED_FOR));
  return { photo_path: path, photo_src: signedUrl };
}

// ------------------------------------------------------ notes & results ---

export async function listNotes(studentId) {
  return must(
    await supabase.from("student_notes").select("*").eq("student_id", studentId).order("created_at", { ascending: false })
  );
}

export async function addNote(schoolId, studentId, body) {
  return must(
    await supabase.from("student_notes").insert({ school_id: schoolId, student_id: studentId, body }).select().single()
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

export async function requestAccess(code, { fullName, designation, phone, subjects, note, classes }) {
  must(
    await supabase.rpc("request_access", {
      p_code: code,
      p_full_name: fullName,
      p_designation: designation,
      p_phone: phone,
      p_subjects: subjects,
      p_note: note,
      p_classes: classes,
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
