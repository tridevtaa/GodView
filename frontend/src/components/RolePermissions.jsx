import { useEffect, useState } from "react";
import { AREAS, ON_OFF, TEACHER_AREAS, saveMemberLevel, saveRoleLevel } from "../data/permissions.js";
import Icon from "./Icon.jsx";

// App access (owner): what each role can do in each area, and exceptions
// for one person. Saved on each tap; the database enforces it.

const ROLES = [
  ["admin", "Admin"],
  ["principal", "Principal"],
  ["teacher", "Teacher"],
];
const LEVELS = [
  [0, "Off"],
  [1, "View"],
  [2, "Edit"],
];
const levelsFor = (area) => (ON_OFF.includes(area) ? [[0, "Off"], [2, "On"]] : LEVELS);
const areasFor = (role) => AREAS.filter(([a]) => role !== "teacher" || TEACHER_AREAS.includes(a));
const levelName = (area, level) => levelsFor(area).find(([l]) => l === level)?.[1] ?? "Off";

function Levels({ area, value, onChange, label, extra }) {
  return (
    <div className="perm-seg" role="radiogroup" aria-label={label}>
      {extra}
      {levelsFor(area).map(([level, name]) => (
        <button key={level} type="button" role="radio" aria-checked={value === level} className={value === level ? `is-on is-l${level}` : ""} onClick={() => onChange(level)}>
          {name}
        </button>
      ))}
    </div>
  );
}

export default function RolePermissions({ school, settings, onChange }) {
  const [role, setRole] = useState("admin");
  const [error, setError] = useState("");

  async function set(area, level) {
    const before = settings.roles[role][area];
    if (before === level) return;
    setError("");
    onChange((s) => ({ ...s, roles: { ...s.roles, [role]: { ...s.roles[role], [area]: level } } }));
    try {
      await saveRoleLevel(school.id, role, area, level);
    } catch {
      onChange((s) => ({ ...s, roles: { ...s.roles, [role]: { ...s.roles[role], [area]: before } } }));
      setError("Couldn’t save that. Check your connection and try again.");
    }
  }

  return (
    <section className="panel perm-panel">
      <div className="members-head">
        <h2 className="panel-title">What each role can do</h2>
        <nav className="segmented members-tabs" aria-label="Role">
          {ROLES.map(([r, name]) => (
            <button key={r} className={role === r ? "active" : ""} onClick={() => setRole(r)}>
              {name}
            </button>
          ))}
        </nav>
      </div>
      <p className="row-sub members-hint">
        {role === "teacher" ? "Teachers only ever see their own classes." : "Owners always have everything."} Tap a person’s key below for an exception.
      </p>
      {error && <p className="field-error">{error}</p>}
      <ul className="perm-list">
        {areasFor(role).map(([area, label, icon, sub]) => (
          <li key={area} className="perm-row">
            <span className="fact-icon" aria-hidden="true">
              <Icon name={icon} size={18} />
            </span>
            <span className="perm-text">
              <strong>{label}</strong>
              <span className="row-sub">{sub}</span>
            </span>
            <Levels area={area} value={settings.roles[role][area]} label={`${label} for ${role}s`} onChange={(level) => set(area, level)} />
          </li>
        ))}
      </ul>
    </section>
  );
}

// One person's exceptions: each area follows their role unless set here.
export function MemberPermissions({ school, member, settings, onChange, onClose }) {
  const [error, setError] = useState("");
  const mine = settings.members[member.email] ?? {};
  const roleLevels = settings.roles[member.role] ?? {};
  const name = member.full_name || member.email;

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function set(area, level) {
    const before = mine[area] ?? null;
    if (before === level) return;
    setError("");
    const apply = (lv) =>
      onChange((s) => {
        const next = { ...(s.members[member.email] ?? {}) };
        if (lv === null) delete next[area];
        else next[area] = lv;
        return { ...s, members: { ...s.members, [member.email]: next } };
      });
    apply(level);
    try {
      await saveMemberLevel(school.id, member.email, area, level);
    } catch {
      apply(before);
      setError("Couldn’t save that. Check your connection and try again.");
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section className="modal perm-modal" role="dialog" aria-modal="true" aria-label={`Permissions for ${name}`} onClick={(e) => e.stopPropagation()}>
        <div className="perm-modal-head">
          <div>
            <h2>{name}</h2>
            <p className="row-sub">Each area follows the {member.role} setting unless you pick something else.</p>
          </div>
          <button className="btn-icon" onClick={onClose} aria-label="Close">
            <Icon name="x" size={18} />
          </button>
        </div>
        {error && <p className="field-error">{error}</p>}
        <ul className="perm-list">
          {areasFor(member.role).map(([area, label, icon]) => {
            const own = mine[area];
            return (
              <li key={area} className={`perm-row${own !== undefined ? " is-custom" : ""}`}>
                <span className="fact-icon" aria-hidden="true">
                  <Icon name={icon} size={18} />
                </span>
                <span className="perm-text">
                  <strong>{label}</strong>
                  <span className="row-sub">{own !== undefined ? `Role: ${levelName(area, roleLevels[area])}` : "As the role"}</span>
                </span>
                <Levels
                  area={area}
                  value={own}
                  label={`${label} for ${name}`}
                  onChange={(level) => set(area, level)}
                  extra={
                    <button type="button" role="radio" aria-checked={own === undefined} className={own === undefined ? "is-on is-role" : ""} onClick={() => set(area, null)}>
                      Role
                    </button>
                  }
                />
              </li>
            );
          })}
        </ul>
        <footer className="del-foot">
          <button className="btn btn-primary" onClick={onClose}>
            Done
          </button>
        </footer>
      </section>
    </div>
  );
}
