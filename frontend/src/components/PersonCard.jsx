import { usePhoto } from "../data/photos.js";

const AVATAR_TINTS = ["#dbeafe", "#fce7f3", "#dcfce7", "#fef3c7", "#ede9fe", "#e0f2fe"];

function initials(name = "") {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("");
}

export function Photo({ person, kind, index }) {
  const stored = usePhoto(kind, person);
  const src = stored || person.photo_url;
  if (src) {
    return <img className="card-photo" src={src} alt={person.name} loading="lazy" />;
  }
  return (
    <div className="card-photo placeholder" style={{ background: AVATAR_TINTS[index % AVATAR_TINTS.length] }}>
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

// "2" -> "Grade 2"; "Nursery" / "KG 1" stay as they are.
export function gradeLabel(klass = "") {
  return /^\d+$/.test(klass) ? `Grade ${klass}` : klass;
}

const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
export const formatINR = (n) => inr.format(n);

export function feeTitle(person) {
  const fee = person.fee_status || "unknown";
  return person.fee_due ? `${FEE_LABEL[fee]}: ${formatINR(person.fee_due)}` : FEE_LABEL[fee];
}

export function relation(gender) {
  if (gender === "F") return "D/O";
  if (gender === "M") return "S/O";
  return "C/O";
}

export default function PersonCard({ person, mode, index, onOpen }) {
  const isStudent = mode === "students";
  const fee = person.fee_status || "unknown";
  return (
    <article
      className="card"
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
      <Photo person={person} kind={mode} index={index} />
      <div className="card-body">
        <div className="card-row">
          <span className="chip-id">{isStudent ? person.admission_no : person.employee_no}</span>
          <span className="tag">
            {isStudent ? gradeLabel(person.class) : person.designation}
          </span>
        </div>
        <div className="card-name">{person.name}</div>
        <div className="card-row">
          <span className="card-sub">
            {isStudent ? `${relation(person.gender)} ${person.parent_name}` : person.department}
          </span>
          {isStudent && (
            <span className={`fee fee-${fee}`} title={feeTitle(person)} aria-label={feeTitle(person)}>
              ₹
            </span>
          )}
        </div>
      </div>
    </article>
  );
}
