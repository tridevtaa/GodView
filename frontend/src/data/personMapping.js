// Maps between database rows (supabase/migrations) and the "person" objects the
// screens use, whose field names predate the database. Pure functions.

// students columns ↔ person fields with different names
const RENAMED = { father_name: "parent_name", aadhaar_last4: "aadhaar", left_on: "left_as_of" };
const ENROLMENT_FIELDS = ["class", "section", "stream", "roll_no", "status"];
const STUDENT_FIELDS = [
  "admission_no", "name", "gender", "dob", "father_name", "mother_name", "parent_phone", "father_phone",
  "mother_phone", "email", "address", "city", "state", "category", "religion", "srn", "aadhaar_last4",
  "admission_date", "admission_type", "admission_category", "pickup_point", "transport_route", "remarks",
  "status", "left_on", "photo_path", "photo_url",
];
const FROM_PERSON = Object.fromEntries(Object.entries(RENAMED).map(([col, field]) => [field, col]));

export function toPerson(student, enrolment, dues) {
  const person = { ...student };
  for (const [col, field] of Object.entries(RENAMED)) {
    person[field] = student[col];
    delete person[col];
  }
  if (enrolment) Object.assign(person, Object.fromEntries(ENROLMENT_FIELDS.map((f) => [f, enrolment[f]])));
  if (dues) {
    Object.assign(person, {
      fee_status: dues.status,
      fee_due: Number(dues.amount) || 0,
      fee_due_months: dues.months,
      fee_breakdown: dues.breakdown,
      fee_as_of: dues.as_of,
    });
  }
  return person;
}

// Empty strings become NULL; dates must be YYYY-MM-DD or NULL.
export function clean(column, value) {
  if (value === undefined) return undefined;
  const v = typeof value === "string" ? value.trim() : value;
  if (v === "" || v === null) return column === "gender" ? "" : null;
  if (["dob", "admission_date", "left_on"].includes(column)) return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
  if (column === "aadhaar_last4") {
    const digits = String(v).replace(/\D/g, "");
    return digits.length >= 4 && !/^0+$/.test(digits) ? digits.slice(-4) : null;
  }
  return v;
}

// Splits person-shaped fields into students columns and enrolment columns.
export function splitFields(fields) {
  const student = {};
  const enrolment = {};
  for (const [field, value] of Object.entries(fields)) {
    if (ENROLMENT_FIELDS.includes(field)) enrolment[field] = field === "status" ? value || "active" : clean(field, value);
    const column = FROM_PERSON[field] ?? field;
    if (STUDENT_FIELDS.includes(column)) {
      const v = clean(column, value);
      if (v !== undefined) student[column] = v;
    }
  }
  if (enrolment.class === null) enrolment.class = "";
  return { student, enrolment };
}
