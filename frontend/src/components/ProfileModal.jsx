import { useEffect } from "react";
import { Photo, FEE_LABEL, relation } from "./PersonCard.jsx";

const DETAILS = {
  students: [
    ["Admission no.", (p) => p.admission_no],
    ["Grade", (p) => [p.class, p.section].filter(Boolean).join(" – ")],
    ["Parent", (p) => p.parent_name && `${relation(p.gender)} ${p.parent_name}`],
    ["Parent phone", (p) => p.parent_phone && <a href={`tel:${p.parent_phone}`}>{p.parent_phone}</a>],
    ["Roll no.", (p) => p.roll_no],
    ["School", (p) => p.school_id],
  ],
  employees: [
    ["Employee no.", (p) => p.employee_no],
    ["Designation", (p) => p.designation],
    ["Department", (p) => p.department],
    ["Phone", (p) => p.phone && <a href={`tel:${p.phone}`}>{p.phone}</a>],
    ["Email", (p) => p.email && <a href={`mailto:${p.email}`}>{p.email}</a>],
    ["Joined", (p) => p.joining_date],
  ],
};

export default function ProfileModal({ person, mode, index, onClose }) {
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const isStudent = mode === "students";
  const fee = person.fee_status || "paid";
  const rows = DETAILS[mode]
    .map(([label, get]) => [label, get(person)])
    .filter(([, value]) => value);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section
        className="modal profile"
        role="dialog"
        aria-modal="true"
        aria-label={`${person.name} profile`}
        onClick={(e) => e.stopPropagation()}
      >
        <button className="profile-close" onClick={onClose} aria-label="Close">
          ×
        </button>
        <div className="profile-head">
          <Photo person={person} index={index} />
          <div>
            <h2>{person.name}</h2>
            <span className="tag">{isStudent ? `Grade ${person.class}` : person.designation}</span>
            {isStudent && (
              <div className="profile-fee">
                <span className={`fee fee-${fee}`} aria-hidden="true">₹</span>
                {FEE_LABEL[fee]}
              </div>
            )}
          </div>
        </div>
        <dl className="profile-details">
          {rows.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}
