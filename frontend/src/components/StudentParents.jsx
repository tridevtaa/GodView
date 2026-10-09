import { useCallback, useEffect, useState } from "react";
import { addGuardian, listGuardians, removeGuardianLink } from "../data/api.js";

const RELATIONS = { father: "Father", mother: "Mother", guardian: "Guardian" };
const show = (phone) => phone.replace(/^\+91(\d{5})(\d{5})$/, "+91 $1 $2");

// Parents who can see this student in the parent app (they sign in with
// these mobile numbers). Owners/admins manage the links.
export default function StudentParents({ person, canEdit }) {
  const [links, setLinks] = useState(null);
  const [form, setForm] = useState({ phone: "", name: "", relation: "guardian" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(null);

  const load = useCallback(async () => {
    try {
      setLinks(await listGuardians(person.id));
    } catch {
      setError("Couldn’t load parents.");
    }
  }, [person.id]);

  useEffect(() => {
    load();
  }, [load]);

  async function add(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await addGuardian(person.id, form);
      setForm({ phone: "", name: "", relation: "guardian" });
      await load();
    } catch (err) {
      setError(/10-digit/.test(err?.message ?? "") ? "Enter a 10-digit Indian mobile number." : "Couldn’t add that parent.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(guardianId) {
    try {
      await removeGuardianLink(guardianId, person.id);
      setConfirm(null);
      await load();
    } catch {
      setError("Couldn’t remove that link.");
    }
  }

  return (
    <div className="parents-view">
      <p className="row-sub">
        These mobile numbers can sign in to the Godview parent app and see {person.name}’s details, results, shared
        notes and fees. Numbers from the student record are linked automatically.
      </p>
      {links === null ? (
        <p className="row-sub">Loading…</p>
      ) : links.length === 0 ? (
        <p className="row-sub">No parent numbers linked yet.</p>
      ) : (
        <ul className="parent-list">
          {links.map((l) => (
            <li key={l.guardian.id}>
              <div>
                <strong>{l.guardian.name || RELATIONS[l.relation]}</strong>
                <span className="row-sub">
                  {show(l.guardian.phone)} · {RELATIONS[l.relation]}
                  {l.source === "auto" ? " · from record" : " · added by staff"}
                </span>
              </div>
              {canEdit &&
                (confirm === l.guardian.id ? (
                  <span className="cancel-confirm">
                    <span className="row-sub">Remove access?</span>
                    <button className="link-btn link-danger" onClick={() => remove(l.guardian.id)}>
                      Remove
                    </button>
                    <button className="link-btn" onClick={() => setConfirm(null)}>
                      Keep
                    </button>
                  </span>
                ) : (
                  <button className="link-btn" onClick={() => setConfirm(l.guardian.id)}>
                    Remove
                  </button>
                ))}
            </li>
          ))}
        </ul>
      )}
      {canEdit && (
        <form className="parent-add" onSubmit={add}>
          <input
            className="input"
            type="tel"
            placeholder="Mobile number"
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
            required
          />
          <input className="input" placeholder="Name (optional)" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <select className="select" value={form.relation} onChange={(e) => setForm({ ...form, relation: e.target.value })}>
            {Object.entries(RELATIONS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
          <button className="btn btn-primary btn-sm" disabled={busy}>
            Add parent
          </button>
        </form>
      )}
      {error && <p className="field-error">{error}</p>}
    </div>
  );
}
