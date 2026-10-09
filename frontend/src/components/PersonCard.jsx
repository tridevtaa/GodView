const AVATAR_TINTS = ["#dbeafe", "#fce7f3", "#dcfce7", "#fef3c7", "#ede9fe", "#e0f2fe"];

function initials(name = "") {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("");
}

export function Photo({ person, index = 0, className = "card-photo" }) {
  // Uploaded photos come as short-lived signed URLs; ERP photos as plain links.
  const src = person.photo_src || person.photo_url;
  if (src) {
    return <img className={className} src={src} alt={person.name} loading="lazy" />;
  }
  return (
    <div className={`${className} placeholder`} style={{ background: AVATAR_TINTS[index % AVATAR_TINTS.length] }}>
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

export default function PersonCard({ person, mode, index, onOpen }) {
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
      <Photo person={person} index={index} />
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
