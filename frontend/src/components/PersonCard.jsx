const AVATAR_TINTS = ["#dbeafe", "#fce7f3", "#dcfce7", "#fef3c7", "#ede9fe", "#e0f2fe"];

function initials(name = "") {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("");
}

export function Photo({ person, index }) {
  if (person.photo_url) {
    return <img className="card-photo" src={person.photo_url} alt={person.name} loading="lazy" />;
  }
  return (
    <div className="card-photo placeholder" style={{ background: AVATAR_TINTS[index % AVATAR_TINTS.length] }}>
      {initials(person.name)}
    </div>
  );
}

export const FEE_LABEL = { paid: "Fees paid", due: "Fees due", overdue: "Fees overdue" };

export function relation(gender) {
  if (gender === "F") return "D/O";
  if (gender === "M") return "S/O";
  return "C/O";
}

export default function PersonCard({ person, mode, index, onOpen }) {
  const isStudent = mode === "students";
  const fee = person.fee_status || "paid";
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
      <Photo person={person} index={index} />
      <div className="card-body">
        <div className="card-row">
          <span className="chip-id">{isStudent ? person.admission_no : person.employee_no}</span>
          <span className="tag">
            {isStudent ? `Grade ${person.class}` : person.designation}
          </span>
        </div>
        <div className="card-name">{person.name}</div>
        <div className="card-row">
          <span className="card-sub">
            {isStudent ? `${relation(person.gender)} ${person.parent_name}` : person.department}
          </span>
          {isStudent && (
            <span className={`fee fee-${fee}`} title={FEE_LABEL[fee]} aria-label={FEE_LABEL[fee]}>
              ₹
            </span>
          )}
        </div>
      </div>
    </article>
  );
}
