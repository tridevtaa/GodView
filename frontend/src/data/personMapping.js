// Maps between database rows (supabase/migrations) and the "person" objects the
// screens use, whose field names predate the database. Pure functions.

// columns ↔ person fields with different names
const RENAMED = { father_name: "parent_name", aadhaar_last4: "aadhaar", left_on: "left_as_of" };
const ENROLMENT_FIELDS = ["class", "section", "stream", "roll_no", "status"];
// students: visible to anyone who can see the student (incl. their teachers)
const STUDENT_FIELDS = [
  "admission_no", "name", "gender", "dob", "father_name", "mother_name", "admission_date", "admission_type",
  "remarks", "status", "left_on", "photo_path", "photo_url",
];
// student_private: owners and admins only
const PRIVATE_FIELDS = [
  "parent_phone", "father_phone", "mother_phone", "email", "address", "city", "state", "category", "religion",
  "srn", "aadhaar_last4", "admission_category", "transport_route", "pickup_point",
  "home_lat", "home_lng", "home_place_id", "uses_bus", "bus_stop_id", "area_id",
];
const FROM_PERSON = Object.fromEntries(Object.entries(RENAMED).map(([col, field]) => [field, col]));

const rename = (row) => {
  const out = { ...row };
  for (const [col, field] of Object.entries(RENAMED)) {
    if (col in out) {
      out[field] = out[col];
      delete out[col];
    }
  }
  return out;
};

// Fee status for tiles and totals from a fee_student_totals row: "due" when
// something is due by today, "overdue" when it's been due for over 15 days,
// "paid" when everything due so far is paid.
export function feeFields(t, today = new Date()) {
  const dueNow = Number(t.due_now) || 0;
  const billed = Number(t.billed) || 0;
  const overdueSince = new Date(today);
  overdueSince.setDate(overdueSince.getDate() - 15);
  const status =
    dueNow > 0
      ? t.next_due_date && new Date(t.next_due_date) < overdueSince
        ? "overdue"
        : "due"
      : billed > 0
        ? "paid"
        : "unknown";
  return {
    fee_status: status,
    fee_due: dueNow,
    fee_balance: Number(t.balance) || 0,
    fee_paid: Number(t.paid) || 0,
    fee_billed: billed,
    fee_next_due: t.next_due_date,
  };
}

// student row (optionally with embedded `private`), enrolment, fee totals → person
export function toPerson(student, enrolment, dues) {
  const { private: privRow, ...base } = student;
  // PostgREST may embed a one-to-one row as an object or a one-item array.
  const priv = Array.isArray(privRow) ? privRow[0] : privRow;
  const person = rename(base);
  if (priv) {
    const { student_id, school_id, updated_at, updated_by, ...details } = priv;
    Object.assign(person, rename(details));
  }
  if (enrolment) Object.assign(person, Object.fromEntries(ENROLMENT_FIELDS.map((f) => [f, enrolment[f]])));
  if (dues) Object.assign(person, feeFields(dues));
  return person;
}

// Empty strings become NULL; dates must be YYYY-MM-DD or NULL.
export function clean(column, value) {
  if (value === undefined) return undefined;
  const v = typeof value === "string" ? value.trim() : value;
  if (v === "" || v === null) return column === "gender" ? "" : null;
  if (["dob", "admission_date", "left_on", "joining_date"].includes(column)) {
    return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
  }
  if (column === "aadhaar_last4") {
    const digits = String(v).replace(/\D/g, "");
    return digits.length >= 4 && !/^0+$/.test(digits) ? digits.slice(-4) : null;
  }
  return v;
}

// Splits person-shaped fields into students, student_private and enrolment columns.
export function splitFields(fields) {
  const student = {};
  const priv = {};
  const enrolment = {};
  for (const [field, value] of Object.entries(fields)) {
    if (ENROLMENT_FIELDS.includes(field)) enrolment[field] = field === "status" ? value || "active" : clean(field, value);
    const column = FROM_PERSON[field] ?? field;
    const v = clean(column, value);
    if (v === undefined) continue;
    if (STUDENT_FIELDS.includes(column)) student[column] = v;
    else if (PRIVATE_FIELDS.includes(column)) priv[column] = v;
  }
  if (enrolment.class === null) enrolment.class = "";
  return { student, private: priv, enrolment };
}
