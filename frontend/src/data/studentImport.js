// Turns an ERP "Student Data" export (one row per student) into Firestore
// writes. Pure functions, no Firebase imports: the in-app Import button and
// one-off scripts share this so both map columns the same way.

// Doc id derived from the registration number (matches earlier imports).
export const studentId = (reg) => "reg-" + String(reg).trim().toUpperCase().replace(/[^A-Za-z0-9-]/g, "-");

const text = (v) => (v === null || v === undefined ? "" : String(v).replace(/\s+/g, " ").trim());

// "22/11/2020" (or a Date cell) -> "2020-11-22"; anything else is kept as typed.
function isoDate(v) {
  if (v instanceof Date && !isNaN(v)) return v.toISOString().slice(0, 10);
  const s = text(v);
  const m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(s);
  return m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : s;
}

// Placeholder IDs like "00000000000000" carry no information.
const realNumber = (v) => {
  const s = text(v).replace(/\s/g, "");
  return /^0+$/.test(s) ? "" : s;
};

const COLUMNS = {
  reg: "Registration Number",
  name: "Student Name",
  course: "Course",
  stream: "Stream",
  section: "Section",
  roll: "Roll Number",
  dob: "Date of Birth",
  gender: "Gender",
  mobile: "Mobile No.",
  father: "Father Name",
  mother: "Mother Name",
  category: "Category",
  religion: "Religion",
  address: "Address",
  city: "City",
  state: "State",
  aadhaar: "Aadhar No.",
  srn: "SRN",
  admissionDate: "Admission Date",
  fatherMobile: "Father Mobile",
  motherMobile: "Mother Mobile",
  email: "Email Id",
  admissionCategory: "Admission Category",
  oldNew: "Old/New",
  remarks: "Remarks",
  pickup: "Pick Up Point",
  photo: "Photo",
};

// Which export column each stored field comes from.
const SOURCE = {
  stream: "stream", section: "section", roll_no: "roll", dob: "dob", gender: "gender",
  parent_phone: "mobile", parent_name: "father", mother_name: "mother",
  father_phone: "fatherMobile", mother_phone: "motherMobile", category: "category",
  religion: "religion", address: "address", city: "city", state: "state", aadhaar: "aadhaar",
  srn: "srn", admission_date: "admissionDate", email: "email",
  admission_category: "admissionCategory", admission_type: "oldNew", remarks: "remarks",
  pickup_point: "pickup", photo_url: "photo",
};

// Throws if the sheet doesn't look like a student export.
export function checkHeaders(headers) {
  const missing = ["reg", "name", "course"].filter((k) => !headers.includes(COLUMNS[k]));
  if (missing.length) {
    throw new Error(`Missing column(s): ${missing.map((k) => COLUMNS[k]).join(", ")}`);
  }
}

// One export row (object keyed by header) -> { id, data } for Firestore.
export function mapRow(row, session) {
  const get = (k) => row[COLUMNS[k]];
  const course = text(get("course"));
  const stream = text(get("stream"));
  const remarks = text(get("remarks"));
  const photo = text(get("photo"));
  const data = {
    admission_no: text(get("reg")),
    name: text(get("name")),
    class: course.replace(/^Class\s+/i, ""),
    stream: stream && stream !== course ? stream : "",
    section: text(get("section")),
    roll_no: text(get("roll")),
    dob: isoDate(get("dob")),
    gender: { male: "M", female: "F" }[text(get("gender")).toLowerCase()] || "",
    parent_phone: text(get("mobile")),
    parent_name: text(get("father")),
    mother_name: text(get("mother")),
    father_phone: text(get("fatherMobile")),
    mother_phone: text(get("motherMobile")),
    category: text(get("category")),
    religion: text(get("religion")),
    address: text(get("address")),
    city: text(get("city")),
    state: text(get("state")),
    aadhaar: realNumber(get("aadhaar")),
    srn: realNumber(get("srn")),
    admission_date: isoDate(get("admissionDate")),
    email: text(get("email")),
    admission_category: text(get("admissionCategory")),
    admission_type: text(get("oldNew")),
    remarks,
    pickup_point: text(get("pickup")),
    // Only real hosted photos; the ERP's placeholder avatars are relative paths.
    photo_url: /^https:\/\//.test(photo) ? photo : "",
    status: /inactive/i.test(remarks) ? "inactive" : "active",
    session,
  };
  // A column missing from this export must not blank out existing values.
  for (const [field, col] of Object.entries(SOURCE)) {
    if (!(COLUMNS[col] in row)) delete data[field];
  }
  if (!(COLUMNS.remarks in row)) delete data.status;
  return { id: studentId(data.admission_no), data };
}

// rows: export rows; existing: current student docs ({ id, status, ... }).
// Returns the writes to make plus counts for a preview.
export function planImport(rows, existing, { session, today }) {
  const seen = new Set();
  const upserts = [];
  const skipped = [];
  for (const row of rows) {
    if (!text(row[COLUMNS.reg]) || !text(row[COLUMNS.name])) {
      skipped.push(row);
      continue;
    }
    const op = mapRow(row, session);
    if (seen.has(op.id)) {
      skipped.push(row);
      continue;
    }
    seen.add(op.id);
    upserts.push(op);
  }
  const byId = new Map(existing.map((s) => [s.id, s]));
  const created = upserts.filter((u) => !byId.has(u.id));
  const updated = upserts.filter((u) => byId.has(u.id));
  const leaving = existing
    .filter((s) => !seen.has(s.id) && s.status !== "left" && !String(s.id).startsWith("sample-"))
    .map((s) => ({ id: s.id, data: { status: "left", left_as_of: today } }));
  return {
    upserts,
    leaving,
    skipped,
    counts: {
      created: created.length,
      updated: updated.length,
      leaving: leaving.length,
      inactive: upserts.filter((u) => u.data.status === "inactive").length,
      skipped: skipped.length,
    },
  };
}
