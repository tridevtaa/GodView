import { useCallback, useEffect, useMemo, useState } from "react";
import {
  addAssignment,
  addMember,
  approveAccessRequest,
  decideExport,
  listAccessRequests,
  listAssignments,
  listClassSections,
  listExportRequests,
  listMembers,
  regenerateJoinCode,
  rejectAccessRequest,
  removeAssignment,
  removeMember,
  setMemberRole,
} from "../data/api.js";
import ClassPicker from "./ClassPicker.jsx";
import SchoolProfile from "./SchoolProfile.jsx";
import { gradeLabel } from "./PersonCard.jsx";
import { gradeRank } from "./GradeFilter.jsx";
import Icon from "./Icon.jsx";

const ROLE_LABEL = { owner: "Owner", admin: "Admin", teacher: "Teacher" };
const ROLE_HINT = {
  admin: "Everything except managing users; exports need your approval",
  teacher: "Only assigned classes; no personal details; photos, notes and results",
};
const fmtDate = (iso) => new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

// Owner-only: members, roles, class assignments, access and export requests.
export default function TeamPage({ school, session, me, onSchoolSaved }) {
  const [members, setMembers] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [classes, setClasses] = useState([]);
  const [requests, setRequests] = useState([]);
  const [exports, setExports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const [m, a, r, x, c] = await Promise.all([
        listMembers(school.id),
        listAssignments(school.id),
        listAccessRequests(school.id),
        listExportRequests(school.id),
        session ? listClassSections(school.id, session.id) : [],
      ]);
      setMembers(m);
      setAssignments(a);
      setRequests(r);
      setExports(x);
      setClasses(
        c.sort((p, q) => gradeRank(p.class) - gradeRank(q.class) || p.section.localeCompare(q.section))
      );
      setError("");
    } catch {
      setError("Couldn’t load the team. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }, [school.id, session]);

  useEffect(() => {
    load();
  }, [load]);

  // Every action reloads; errors surface in one place.
  const act = (fn) => async (...args) => {
    try {
      await fn(...args);
      await load();
    } catch {
      setError("That didn’t go through. Check your connection and try again.");
    }
  };

  const pendingExports = exports.filter((x) => x.status === "pending");
  const sessionAssignments = assignments.filter((a) => a.session_id === session?.id);

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="sr-only">Team</h1>
          <div className="page-meta">
            <span className="page-count">{loading ? "Loading…" : `${members.length} members`}</span>
            {session && <span className="badge badge-neutral">Classes for {session.name}</span>}
          </div>
        </div>
      </div>

      {error && <p className="notice notice-error">{error}</p>}

      <SchoolProfile key={school.updated_at} school={school} onSaved={onSchoolSaved} />

      <JoinCode school={school} />

      {requests.length > 0 && (
        <section className="panel">
          <h2 className="panel-title">
            Access requests <span className="badge badge-warning">{requests.length}</span>
          </h2>
          {requests.map((r) => (
            <AccessRequestRow
              key={r.id}
              request={r}
              classOptions={classes}
              onApprove={act((role, picked) => approveAccessRequest(r.id, role, picked))}
              onReject={act(() => rejectAccessRequest(r.id, me))}
            />
          ))}
        </section>
      )}

      {pendingExports.length > 0 && (
        <section className="panel">
          <h2 className="panel-title">
            Export requests <span className="badge badge-warning">{pendingExports.length}</span>
          </h2>
          {pendingExports.map((x) => (
            <div key={x.id} className="row">
              <div className="row-main">
                <div className="row-title">{x.requested_by}</div>
                <div className="row-sub">
                  Wants to export {x.scope} · {fmtDate(x.created_at)}
                  {x.reason ? ` · “${x.reason}”` : ""}
                </div>
              </div>
              <div className="row-actions">
                <button className="btn btn-secondary btn-sm" onClick={act(() => decideExport(x.id, false, me))}>
                  Reject
                </button>
                <button className="btn btn-primary btn-sm" onClick={act(() => decideExport(x.id, true, me))}>
                  Approve once
                </button>
              </div>
            </div>
          ))}
        </section>
      )}

      <section className="panel">
        <h2 className="panel-title">Members</h2>
        {members.map((m) => (
          <MemberRow
            key={m.email}
            member={m}
            isMe={m.email === me}
            classes={classes}
            assignments={sessionAssignments.filter((a) => a.email === m.email)}
            onRole={act((role) => setMemberRole(school.id, m.email, role))}
            onRemove={act(() => removeMember(school.id, m.email))}
            onAssign={act((k, s) => addAssignment(school.id, session.id, m.email, k, s))}
            onUnassign={act((id) => removeAssignment(id))}
            canAssign={Boolean(session)}
          />
        ))}
        <AddMember
          onAdd={act((email, role, details) => addMember(school.id, email, role, details))}
          existing={members}
        />
      </section>

      <p className="panel-foot">
        Staff join by signing in with Google and entering the join code above. You can also add someone’s Google email
        directly.
      </p>
    </>
  );
}

function RolePicker({ value, onChange, disabled }) {
  return (
    <select className="select" value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled}>
      <option value="teacher">Teacher</option>
      <option value="admin">Admin</option>
    </select>
  );
}

function JoinCode({ school }) {
  const [code, setCode] = useState(school.join_code);
  const [state, setState] = useState("idle"); // idle | copied | confirm | busy | error

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setState("copied");
      setTimeout(() => setState("idle"), 1500);
    } catch {
      setState("idle");
    }
  }

  async function regenerate() {
    setState("busy");
    try {
      setCode(await regenerateJoinCode(school.id));
      setState("idle");
    } catch {
      setState("error");
    }
  }

  return (
    <section className="panel join-panel">
      <div>
        <h2 className="panel-title">School join code</h2>
        <p className="row-sub join-help">
          Share this with your staff. They sign in with Google, enter it, and request to join — you approve below.
        </p>
      </div>
      <div className="join-code-row">
        <code className="join-code">{code}</code>
        <button className="btn btn-secondary btn-sm" onClick={copy}>
          {state === "copied" ? "Copied" : "Copy"}
        </button>
        {state === "confirm" ? (
          <>
            <span className="row-sub">The old code will stop working.</span>
            <button className="btn btn-secondary btn-sm" onClick={() => setState("idle")}>
              Cancel
            </button>
            <button className="btn btn-danger btn-sm" onClick={regenerate}>
              Regenerate
            </button>
          </>
        ) : (
          <button className="btn btn-secondary btn-sm" onClick={() => setState("confirm")} disabled={state === "busy"}>
            New code
          </button>
        )}
        {state === "error" && <span className="field-error">Couldn’t change the code.</span>}
      </div>
    </section>
  );
}

function AccessRequestRow({ request, classOptions, onApprove, onReject }) {
  const [role, setRole] = useState("teacher");
  const [picked, setPicked] = useState(request.requested_classes ?? []);
  const [showClasses, setShowClasses] = useState(false);
  const facts = [request.designation, request.phone, request.subjects && `Teaches ${request.subjects}`].filter(Boolean);
  const summary = picked.length
    ? picked.map((c) => `${gradeLabel(c.class)}${c.section ? ` · ${c.section}` : ""}`).join(", ")
    : "No classes chosen";

  return (
    <div className="row row-request">
      <div className="row-main">
        <div className="row-title">{request.name || request.email}</div>
        <div className="row-sub">
          {request.email} · {fmtDate(request.created_at)}
        </div>
        {facts.length > 0 && <div className="row-sub">{facts.join(" · ")}</div>}
        {request.message && <div className="row-sub">“{request.message}”</div>}
        {role === "teacher" && (
          <div className="request-classes">
            <button type="button" className="link-btn" onClick={() => setShowClasses((v) => !v)}>
              {showClasses ? "Done" : "Classes:"}
            </button>{" "}
            {!showClasses && <span className="row-sub">{summary}</span>}
            {showClasses && <ClassPicker options={classOptions} value={picked} onChange={setPicked} />}
          </div>
        )}
      </div>
      <div className="row-actions">
        <RolePicker value={role} onChange={setRole} />
        <button className="btn btn-secondary btn-sm" onClick={onReject}>
          Reject
        </button>
        <button className="btn btn-primary btn-sm" onClick={() => onApprove(role, role === "teacher" ? picked : [])}>
          Approve
        </button>
      </div>
    </div>
  );
}

function MemberRow({ member, isMe, classes, assignments, onRole, onRemove, onAssign, onUnassign, canAssign }) {
  const [confirming, setConfirming] = useState(false);
  const [pick, setPick] = useState("");
  const isOwner = member.role === "owner";
  const taken = new Set(assignments.map((a) => `${a.class}|${a.section ?? ""}`));
  const options = useMemo(() => {
    const byClass = new Map();
    classes.forEach((c) => byClass.set(c.class, [...(byClass.get(c.class) ?? []), c.section]));
    return [...byClass].flatMap(([k, sections]) => [
      { value: `${k}|`, label: `${gradeLabel(k)} · all sections` },
      ...sections.filter(Boolean).map((s) => ({ value: `${k}|${s}`, label: `${gradeLabel(k)} · ${s}` })),
    ]);
  }, [classes]);

  return (
    <div className="row row-member">
      <div className="row-main">
        <div className="row-title">
          {member.full_name || member.email} {isMe && <span className="badge badge-neutral">You</span>}
        </div>
        <div className="row-sub">
          {[member.full_name && member.email, member.designation, member.phone].filter(Boolean).join(" · ")}
        </div>
        <div className="row-sub">{isOwner ? "Full control, manages users" : ROLE_HINT[member.role]}</div>
        {member.role === "teacher" && (
          <div className="chips">
            {assignments.map((a) => (
              <span key={a.id} className="chip">
                {gradeLabel(a.class)}
                {a.section ? ` · ${a.section}` : " · all"}
                <button aria-label="Remove class" onClick={() => onUnassign(a.id)}>
                  <Icon name="x" size={12} />
                </button>
              </span>
            ))}
            {canAssign && (
              <select
                className="select select-sm"
                value={pick}
                onChange={(e) => {
                  const [k, s] = e.target.value.split("|");
                  if (k) onAssign(k, s);
                  setPick("");
                }}
              >
                <option value="">+ Assign class</option>
                {options
                  .filter((o) => !taken.has(o.value))
                  .map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
              </select>
            )}
            {!assignments.length && <span className="row-sub">No classes yet — they’ll see no students.</span>}
          </div>
        )}
      </div>
      <div className="row-actions">
        {isOwner ? (
          <span className="badge badge-brand">Owner</span>
        ) : confirming ? (
          <>
            <span className="row-sub">Remove access?</span>
            <button className="btn btn-secondary btn-sm" onClick={() => setConfirming(false)}>
              Cancel
            </button>
            <button className="btn btn-danger btn-sm" onClick={onRemove}>
              Remove
            </button>
          </>
        ) : (
          <>
            <RolePicker value={member.role} onChange={onRole} />
            <button className="btn btn-secondary btn-sm" onClick={() => setConfirming(true)}>
              Remove
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function AddMember({ onAdd, existing }) {
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [designation, setDesignation] = useState("");
  const [role, setRole] = useState("teacher");
  const duplicate = existing.some((m) => m.email === email.trim().toLowerCase());
  return (
    <form
      className="row row-add"
      onSubmit={(e) => {
        e.preventDefault();
        if (duplicate) return;
        onAdd(email, role, { full_name: fullName, designation });
        setEmail("");
        setFullName("");
        setDesignation("");
      }}
    >
      <input className="input" type="email" required placeholder="Google email" value={email} onChange={(e) => setEmail(e.target.value)} />
      <input className="input" placeholder="Full name" value={fullName} onChange={(e) => setFullName(e.target.value)} maxLength={120} />
      <input className="input" placeholder="Designation" value={designation} onChange={(e) => setDesignation(e.target.value)} maxLength={80} />
      <RolePicker value={role} onChange={setRole} />
      <button className="btn btn-primary btn-sm" disabled={!email || duplicate}>
        <Icon name="plus" />
        Add member
      </button>
      {duplicate && <span className="row-sub">Already a member.</span>}
    </form>
  );
}
