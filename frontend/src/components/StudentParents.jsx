import { useCallback, useEffect, useState } from "react";
import { addGuardian, listGuardians, removeGuardianLink } from "../data/api.js";

const RELATIONS = { father: "Father", mother: "Mother", guardian: "Guardian" };
const show = (phone) => phone.replace(/^\+91(\d{5})(\d{5})$/, "+91 $1 $2");

// Parents who can see this student in the parent app (they sign in with
// these mobile numbers). Owners/admins manage the links. Shown inside the
// student's Details, under Family.
export default function StudentParents({ person, canEdit }) {
  const [adding, setAdding] = useState(false);
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
      setAdding(false);
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
      <div className="parents-head">
        <h4 title="These numbers sign in to the Godview parent app">Parent app</h4>
        {canEdit && !adding && (
          <button type="button" className="link-btn" onClick={() => setAdding(true)}>
            + Add number
          </button>
        )}
      </div>
      {links === null ? (
        <p className="row-sub">Loading…</p>
      ) : links.length === 0 ? (
        <p className="row-sub">No numbers yet</p>
      ) : (
        <ul className="parent-list">
          {links.map((l) => (
            <li key={l.guardian.id}>
              <div>
                <a href={`tel:${l.guardian.phone}`}>{show(l.guardian.phone)}</a>
                <span className="row-sub">
                  {[l.guardian.name, RELATIONS[l.relation]].filter(Boolean).join(" · ")}
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
      {canEdit && adding && (
        <form className="parent-add" onSubmit={add}>
          <input
            className="input"
            type="tel"
            placeholder="Mobile number"
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
            required
            autoFocus
          />
          <input className="input" placeholder="Name (optional)" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <select className="select" value={form.relation} onChange={(e) => setForm({ ...form, relation: e.target.value })}>
            {Object.entries(RELATIONS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setAdding(false)}>
            Cancel
          </button>
          <button className="btn btn-primary btn-sm" disabled={busy}>
            Add
          </button>
        </form>
      )}
      {error && <p className="field-error">{error}</p>}
    </div>
  );
}
