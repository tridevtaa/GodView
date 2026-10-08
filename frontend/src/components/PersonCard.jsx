import { usePhoto } from "../data/photos.js";

function initials(name = "") {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("");
}

export function Photo({ person, kind, className = "" }) {
  const stored = usePhoto(kind, person);
  const src = stored || person.photo_url;
  if (src) {
    return <img className={`photo ${className}`} src={src} alt={person.name} loading="lazy" />;
  }
  return (
    <div className={`photo photo-placeholder ${className}`} aria-hidden="true">
      {initials(person.name)}
    </div>
  );
}

// Badge for the fee status; nothing when it isn't recorded.
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

export default function PersonCard({ person, mode, onOpen }) {
  const isStudent = mode === "students";
  const inactive = person.status === "inactive";
  return (
    <article
      className={`card${inactive ? " is-inactive" : ""}`}
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
      <div className="card-media">
        <Photo person={person} kind={mode} />
        {inactive && <span className="badge badge-neutral card-flag">Inactive</span>}
      </div>
      <div className="card-body">
        <span className="card-id">{isStudent ? person.admission_no : person.employee_no}</span>
        <div className="card-name" title={person.name}>{person.name}</div>
        <div className="card-sub">
          {isStudent
            ? person.parent_name && `${relation(person.gender)} ${person.parent_name}`
            : person.department}
        </div>
        <div className="card-meta">
          <span className="badge badge-brand">{isStudent ? gradeLabel(person.class) : person.designation}</span>
          {isStudent && <FeeBadge person={person} />}
        </div>
      </div>
    </article>
  );
}
