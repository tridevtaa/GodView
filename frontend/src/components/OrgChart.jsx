import { useMemo, useState } from "react";
import { updateEmployee } from "../data/api.js";
import { below, buildOrgChart } from "../data/orgChart.js";
import { Photo } from "./PersonCard.jsx";
import Icon from "./Icon.jsx";

// Staff > People, Chart view: who reports to whom. Placed from designations,
// unless an owner or admin set someone's line ("Edit lines"). Tapping a person
// opens their profile. matches: ids that fit the search, highlighted.
export default function OrgChart({ staff, school, canEdit, matches, onOpen, onPatch }) {
  const { roots, looseGroups, nodes } = useMemo(() => buildOrgChart(staff), [staff]);
  const [editing, setEditing] = useState(false);
  const [open, setOpen] = useState(() => new Set());
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState("");

  // Everyone, leaders first, for the "reports to" pickers.
  const everyone = useMemo(
    () => [...nodes.values()].sort((a, b) => (a.tier === b.tier ? String(a.person.name).localeCompare(String(b.person.name)) : rank(a) - rank(b))),
    [nodes]
  );

  async function setBoss(person, bossId) {
    setBusy(person.id);
    setError("");
    try {
      await updateEmployee(person, { reports_to: bossId });
      onPatch(person.id, { reports_to: bossId || null });
    } catch {
      setError("Couldn’t change that line. Check your connection and try again.");
    } finally {
      setBusy(null);
    }
  }

  const ctx = { editing, open, setOpen, busy, setBoss, everyone, nodes, matches, onOpen };
  // One person (or more) at the top: the school sits above them.
  const top = roots.length === 1 && !looseGroups.length ? roots[0] : null;

  if (!nodes.size) return null;
  return (
    <section className="org">
      {canEdit && (
        <div className="org-bar">
          {editing && <p className="row-sub">Pick who each person reports to. Auto places them by designation.</p>}
          <button className={`btn btn-sm ${editing ? "btn-primary" : "btn-secondary"}`} onClick={() => setEditing((v) => !v)}>
            {editing ? <Icon name="check" size={14} /> : <Icon name="edit" size={14} />}
            {editing ? "Done" : "Edit lines"}
          </button>
        </div>
      )}
      {error && <p className="notice notice-error">{error}</p>}
      <div className="org-scroll">
        <ul className="org-tree">
          {top ? (
            <Node node={top} ctx={ctx} />
          ) : (
            <li>
              <div className="org-box org-school">
                <Icon name="academics" size={22} />
                <span className="org-name">{school.name}</span>
                <span className="org-role">{nodes.size} staff</span>
              </div>
              <ul>
                {roots.map((n) => (
                  <Node key={n.person.id} node={n} ctx={ctx} />
                ))}
                {looseGroups.map((g) => (
                  <Group key={g.tier} group={g} id={`top:${g.tier}`} ctx={ctx} />
                ))}
              </ul>
            </li>
          )}
        </ul>
      </div>
    </section>
  );
}

const RANKS = ["head", "principal", "vice", "lead", "teacher", "office", "support", "other"];
const rank = (n) => RANKS.indexOf(n.tier);

function Node({ node, ctx }) {
  const kids = node.children.length + node.groups.length;
  return (
    <li>
      <div className={`org-box${ctx.matches?.has(node.person.id) ? " is-match" : ""}`}>
        <button type="button" className="org-person" onClick={() => ctx.onOpen(node.person.id)}>
          <Photo person={node.person} className="org-photo" />
          <span className="org-name">{node.person.name}</span>
          <span className="org-role">{node.person.designation || "Teacher"}</span>
        </button>
        {ctx.editing && <ReportsTo node={node} ctx={ctx} />}
      </div>
      {kids > 0 && (
        <ul>
          {node.children.map((c) => (
            <Node key={c.person.id} node={c} ctx={ctx} />
          ))}
          {node.groups.map((g) => (
            <Group key={g.tier} group={g} id={`${node.person.id}:${g.tier}`} ctx={ctx} />
          ))}
        </ul>
      )}
    </li>
  );
}

// Teachers, office, support or other staff under one person: a box that opens
// into a list. It opens by itself when a search matches someone in it.
function Group({ group, id, ctx }) {
  const hit = ctx.matches && group.members.some((m) => ctx.matches.has(m.person.id));
  const isOpen = ctx.open.has(id) || ctx.editing || hit;
  const toggle = () =>
    ctx.setOpen((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  return (
    <li>
      <div className={`org-box org-group${isOpen ? " is-open" : ""}`}>
        <button type="button" className="org-group-head" onClick={toggle} aria-expanded={isOpen}>
          <span className="org-faces">
            {group.members.slice(0, 3).map((m) => (
              <Photo key={m.person.id} person={m.person} className="org-face" />
            ))}
          </span>
          <span className="org-name">{group.label}</span>
          <span className="org-count">{group.members.length}</span>
          <Icon name="chevronDown" size={16} className="org-chev" />
        </button>
        {isOpen && (
          <ul className="org-members">
            {group.members.map((m) => (
              <li key={m.person.id} className={ctx.matches?.has(m.person.id) ? "is-match" : ""}>
                <button type="button" className="org-member" onClick={() => ctx.onOpen(m.person.id)}>
                  <Photo person={m.person} className="org-face" />
                  <span>
                    <span className="org-member-name">{m.person.name}</span>
                    <span className="org-role">{m.person.designation || "Teacher"}</span>
                  </span>
                </button>
                {ctx.editing && <ReportsTo node={m} ctx={ctx} />}
              </li>
            ))}
          </ul>
        )}
      </div>
    </li>
  );
}

function ReportsTo({ node, ctx }) {
  const p = node.person;
  const blocked = below(node);
  const options = ctx.everyone.filter((n) => n.person.id !== p.id && !blocked.has(n.person.id));
  return (
    <label className="org-reports">
      <span>Reports to</span>
      <select className="select" value={p.reports_to && ctx.nodes.has(p.reports_to) ? p.reports_to : ""} disabled={ctx.busy === p.id} onChange={(e) => ctx.setBoss(p, e.target.value)}>
        <option value="">Auto</option>
        {options.map((n) => (
          <option key={n.person.id} value={n.person.id}>
            {n.person.name}
            {n.person.designation ? ` · ${n.person.designation}` : ""}
          </option>
        ))}
      </select>
    </label>
  );
}
