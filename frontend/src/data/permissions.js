import { createContext, useContext, useEffect, useState } from "react";
import { supabase } from "../supabase.js";

// Role permissions (migration 20261201000000): the owner sets Off (0), View
// (1) or Edit (2) for each area, per role and per person. The database
// enforces them; the app uses them to show only what each person can use.

// [key, label, icon, what it covers]
export const AREAS = [
  ["fees", "Fees", "rupee", "Dues, collection, reports"],
  ["admissions", "Admissions", "newAdmission", "Enquiries and registrations"],
  ["certificates", "Certificates", "certificate", "TC, bona fide and others"],
  ["transport", "Transport", "bus", "Routes, stops, buses"],
  ["staff", "Staff", "teacher", "Staff records and join requests"],
  ["students", "Student details", "idcard", "Contact, address, documents"],
  ["attendance", "Attendance", "register", "The daily register"],
  ["results", "Results", "chart", "Exam marks"],
  ["notices", "Notices", "notice", "Noticeboard"],
  ["assistant", "Goddess", "sparkle", "AI assistant and insights"],
];

// Teachers work inside their own classes: only these areas apply to them.
export const TEACHER_AREAS = ["attendance", "results", "students", "notices"];
// Goddess is on or off.
export const ON_OFF = ["assistant"];

// What each role had before settings existed (default_level in SQL).
export function defaultLevel(role, area) {
  if (role === "owner" || role === "admin") return 2;
  if (role === "principal") return { notices: 2, assistant: 2, admissions: 1, staff: 1, students: 1, attendance: 1, results: 1 }[area] ?? 0;
  if (role === "teacher") return { attendance: 2, results: 2, notices: 2 }[area] ?? 0;
  return 0;
}

export const defaultsFor = (role) => Object.fromEntries(AREAS.map(([a]) => [a, defaultLevel(role, a)]));

export const PermsContext = createContext(null);

// The signed-in person's levels: the role's defaults at once, then what
// the owner set.
export function useMyPermissions(schoolId, role) {
  const [perms, setPerms] = useState(() => defaultsFor(role));
  useEffect(() => {
    setPerms(defaultsFor(role));
    if (!schoolId) return;
    let live = true;
    supabase.rpc("my_permissions", { p_school: schoolId }).then(({ data, error }) => {
      if (live && !error && data) setPerms({ ...defaultsFor(role), ...data });
    });
    return () => {
      live = false;
    };
  }, [schoolId, role]);
  return perms;
}

// In any screen: levels for the signed-in person (defaults to all on, for
// screens that may render outside the staff app).
export function usePerms() {
  return useContext(PermsContext) ?? defaultsFor("owner");
}

// ------------------------------------------------------- owner's settings ---

const must = ({ data, error }) => {
  if (error) throw error;
  return data;
};

// { roles: { admin: { fees: 2, ... }, principal, teacher }, members: { email: { area: level } } }
export async function loadPermissionSettings(schoolId) {
  const [roles, members] = await Promise.all([
    supabase.from("role_permissions").select("role, area, level").eq("school_id", schoolId).then(must),
    supabase.from("member_permissions").select("email, area, level").eq("school_id", schoolId).then(must),
  ]);
  const out = { roles: {}, members: {} };
  for (const role of ["admin", "principal", "teacher"]) out.roles[role] = defaultsFor(role);
  for (const r of roles) out.roles[r.role][r.area] = r.level;
  for (const m of members) (out.members[m.email] ??= {})[m.area] = m.level;
  return out;
}

export async function saveRoleLevel(schoolId, role, area, level) {
  must(await supabase.from("role_permissions").upsert({ school_id: schoolId, role, area, level }, { onConflict: "school_id,role,area" }));
}

// level null: back to the role's setting.
export async function saveMemberLevel(schoolId, email, area, level) {
  if (level === null) must(await supabase.from("member_permissions").delete().eq("school_id", schoolId).eq("email", email).eq("area", area));
  else must(await supabase.from("member_permissions").upsert({ school_id: schoolId, email, area, level }, { onConflict: "school_id,email,area" }));
}
