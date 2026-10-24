import { supabase } from "../supabase.js";
import { toThumbnail } from "./photos.js";
import { myClassAllocationRequest, withPhotoUrls } from "./api.js";

// A staff member's own profile: their membership (name, designation,
// phone, role), their staff record when they have one (photo), and for
// teachers their classes this session and any class request waiting.

const must = ({ data, error }) => {
  if (error) throw error;
  return data;
};

export async function loadMyProfile(schoolId, email, sessionId) {
  const [member, staffRows, classes, request] = await Promise.all([
    supabase.from("school_members").select("full_name, designation, phone, role").eq("school_id", schoolId).eq("email", email).maybeSingle().then(must),
    supabase.rpc("my_staff_record", { p_school: schoolId }).then(must).catch(() => []),
    sessionId
      ? supabase.from("teacher_classes").select("id, class, section, is_class_teacher").eq("school_id", schoolId).eq("session_id", sessionId).eq("email", email).then(must)
      : Promise.resolve([]),
    myClassAllocationRequest(schoolId).catch(() => null),
  ]);
  const [staff] = staffRows?.length ? await withPhotoUrls(staffRows).catch(() => staffRows) : [null];
  return { member, staff, classes: classes ?? [], request };
}

export async function saveMyProfile(schoolId, f) {
  must(
    await supabase.rpc("update_my_profile", {
      p_school: schoolId,
      p_full_name: f.fullName,
      p_designation: f.designation,
      p_phone: f.phone,
      p_id_type: f.idType,
      p_id_last4: f.idLast4,
      p_emergency_name: f.emergencyName,
      p_emergency_phone: f.emergencyPhone,
      p_qualification: f.qualification,
      p_subjects: f.subjects,
      p_joining_date: f.joiningDate || null,
    })
  );
}

// A new photo for their own staff record; returns its link.
export async function saveMyPhoto(schoolId, staff, file) {
  if (!file.type.startsWith("image/")) throw new Error("not-an-image");
  const blob = await toThumbnail(file);
  const path = `${schoolId}/employees/${staff.id}-${Date.now()}.jpg`;
  must(await supabase.storage.from("photos").upload(path, blob, { contentType: blob.type || "image/jpeg" }));
  must(await supabase.rpc("set_my_photo", { p_school: schoolId, p_path: path }));
  const { signedUrl } = must(await supabase.storage.from("photos").createSignedUrl(path, 3600));
  return { photo_path: path, photo_src: signedUrl };
}

// ------------------------------------------------------------ parents ---

// The signed-in parent's details (one row per school; the first one is
// shown) with each linked child and the relation.
export async function loadMyGuardian() {
  const rows = must(await supabase.rpc("my_guardian_profile"));
  if (!rows?.length) return null;
  const [first] = await withPhotoUrls(rows.slice(0, 1)).catch(() => rows.slice(0, 1));
  return { ...first, children: rows.flatMap((r) => r.children ?? []) };
}

export async function saveMyGuardian({ name, email, idType, idLast4, address }) {
  must(await supabase.rpc("update_my_guardian", { p_name: name, p_email: email, p_id_type: idType, p_id_last4: idLast4, p_address: address }));
}

export async function saveMyGuardianPhoto(guardian, file) {
  if (!file.type.startsWith("image/")) throw new Error("not-an-image");
  const blob = await toThumbnail(file);
  const path = `${guardian.school_id}/guardians/${guardian.id}-${Date.now()}.jpg`;
  must(await supabase.storage.from("photos").upload(path, blob, { contentType: blob.type || "image/jpeg" }));
  must(await supabase.rpc("set_my_guardian_photo", { p_school: guardian.school_id, p_path: path }));
  const { signedUrl } = must(await supabase.storage.from("photos").createSignedUrl(path, 3600));
  return { photo_path: path, photo_src: signedUrl };
}
