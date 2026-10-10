import { useState } from "react";
const AVATAR_TINTS = ["#dbeafe", "#fce7f3", "#dcfce7", "#fef3c7", "#ede9fe", "#e0f2fe"];

function initials(name = "") {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("");
}

// A student's tint follows them (same colour on the tile and in the profile).
export function tintFor(person) {
  const key = String(person?.id ?? person?.name ?? "");
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return AVATAR_TINTS[h % AVATAR_TINTS.length];
}

// The old ERP sometimes stored a PDF or Word file as the "photo".
export const isImageUrl = (url = "") => /\.(jpe?g|png|webp|gif|heic)$/i.test(url.split("?")[0]);

export function Photo({ person, className = "card-photo" }) {
  // Uploaded photos come as short-lived signed URLs; ERP photos as plain links.
  const src = person.photo_src || (isImageUrl(person.photo_url) ? person.photo_url : "");
  const [failed, setFailed] = useState(null); // the src that didn't load
  if (src && failed !== src) {
    // crossOrigin lets the app keep a copy of the photo on the device.
    return <img className={className} src={src} alt={person.name} loading="lazy" decoding="async" crossOrigin="anonymous" onError={() => setFailed(src)} />;
  }
  return (
    <div className={`${className} placeholder`} style={{ background: tintFor(person) }}>
      {initials(person.name)}
    </div>
  );
}

export const FEE_LABEL = {
  paid: "Fees paid",
  due: "Fees due",
  overdue: "Fees overdue",
  unknown: "Fee status not recorded",
};

// The school's own grade names (school_grades.label by code), set once the
// school loads. Falls back to "Grade 2" for numbers and the code otherwise.
let GRADE_LABELS = new Map();
export function setGradeLabels(grades) {
  GRADE_LABELS = new Map(grades.map((g) => [g.code, g.label]));
}

export function gradeLabel(klass = "") {
  return GRADE_LABELS.get(klass) ?? (/^\d+$/.test(klass) ? `Grade ${klass}` : klass);
}

const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
export const formatINR = (n) => inr.format(n);

export function feeTitle(person) {
  const fee = person.fee_status || "unknown";
  return person.fee_due ? `${FEE_LABEL[fee]}: ${formatINR(person.fee_due)}` : FEE_LABEL[fee];
}

// Pill for the fee status in the profile; nothing when it isn't recorded.
export function FeeBadge({ person }) {
  const fee = person.fee_status;
  if (!fee || fee === "unknown") return null;
  const tone = { paid: "success", due: "warning", overdue: "danger" }[fee];
  const label = { paid: "Paid", due: "Due", overdue: "Overdue" }[fee];
  return (
    <span className={`badge badge-${tone}`} title={feeTitle(person)}>
      {label}
    </span>
  );
}

export function relation(gender) {
  if (gender === "F") return "D/O";
  if (gender === "M") return "S/O";
  return "C/O";
}

export default function PersonCard({ person, mode, index, showFee = true, onOpen }) {
  const isStudent = mode === "students";
  const fee = person.fee_status || "unknown";
  return (
    <article
      className={`card${person.status === "inactive" ? " inactive" : ""}`}
      role="button"
      tabIndex={0}
      aria-label={`Open profile of ${person.name}`}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
    >
      <Photo person={person} />
      <div className="card-body">
        <div className="card-row">
          <span className="chip-id">{isStudent ? person.admission_no : person.employee_no}</span>
          <span className="tag">
            {isStudent ? gradeLabel(person.class) : person.designation}
          </span>
        </div>
        {person.status === "inactive" && <span className="card-status">Inactive</span>}
        <div className="card-name">{person.name}</div>
        <div className="card-row">
          <span className="card-sub">
            {isStudent ? `${relation(person.gender)} ${person.parent_name}` : person.department}
          </span>
          {isStudent && showFee && (
            <span className={`fee fee-${fee}`} title={feeTitle(person)} aria-label={feeTitle(person)}>
              ₹
            </span>
          )}
        </div>
      </div>
    </article>
  );
}
