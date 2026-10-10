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
  setClassTeacher,
  withPhotoUrls,
} from "../data/api.js";
import ClassPicker from "./ClassPicker.jsx";
import SchoolProfile from "./SchoolProfile.jsx";
import TransportRoutes from "./TransportRoutes.jsx";
import { Photo, gradeLabel } from "./PersonCard.jsx";
import { gradeRank } from "./GradeFilter.jsx";
import Icon from "./Icon.jsx";

const ROLE_LABEL = { owner: "Owner", admin: "Admin", principal: "Principal", teacher: "Teacher" };
// What each role can do, shown when picking one.
const ROLE_HINT = {
  teacher: "Their classes only",
  admin: "Everything except users",
  principal: "Sees everything, changes nothing",
};
const fmtDate = (iso) => new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

const SCHOOL_TABS = [
  ["profile", "Profile"],
  ["transport", "Transport"],
];

// Owner only, in two places:
// view "school": School settings (profile and join code, transport).
// view "access": Staff > App access (join requests, export requests, who
// can sign in and with what role, class assignments).
export default function TeamPage({ view = "access", school, session, me, onSchoolSaved, students, routes = [], onRoutesChanged, tab: shownTab, onTab, onCount }) {
  const [ownTab, setOwnTab] = useState("profile");
  const tab = shownTab === "transport" ? "transport" : shownTab ? "profile" : ownTab;
  const setTab = onTab ?? setOwnTab;
  const [members, setMembers] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [classes, setClasses] = useState([]);
  const [requests, setRequests] = useState([]);
  const [exports, setExports] = useState([]);
  const [memberTab, setMemberTab] = useState("teachers");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (view !== "access") return setLoading(false);
    try {
      const [m, a, r, x, c] = await Promise.all([
        listMembers(school.id),
        listAssignments(school.id),
        listAccessRequests(school.id).then(withPhotoUrls),
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
  }, [school.id, session, view]);

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
  const waiting = requests.length + pendingExports.length;
  useEffect(() => {
    if (!loading) onCount?.(waiting);
  }, [waiting, loading, onCount]);

  if (view === "school") {
    return (
      <>
        <div className="page-header">
          <div className="page-meta">
            <h1 className="page-count">School</h1>
            <nav className="segmented segmented-sm" aria-label="School settings">
              {SCHOOL_TABS.map(([v, l]) => (
                <button key={v} className={tab === v ? "active" : ""} onClick={() => setTab(v)}>
                  {l}
                </button>
              ))}
            </nav>
          </div>
        </div>
        {tab === "transport" ? (
          <TransportRoutes school={school} routes={routes} students={students} onChanged={onRoutesChanged} />
        ) : (
          <SchoolProfile key={school.updated_at} school={school} onSaved={onSchoolSaved} aside={<JoinCode school={school} />} />
        )}
      </>
    );
  }

  return (
    <>
      {error && <p className="notice notice-error">{error}</p>}

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
        <div className="members-head">
          <h2 className="panel-title">Who can sign in</h2>
          <nav className="segmented members-tabs" aria-label="Member groups">
            {MEMBER_GROUPS.map(([group, title, short]) => (
              <button key={group} className={memberTab === group ? "active" : ""} onClick={() => setMemberTab(group)}>
                <span className="tab-full">{title}</span>
                <span className="tab-short">{short}</span>
                <span className="members-tab-count">{members.filter((m) => memberGroup(m) === group).length}</span>
              </button>
            ))}
          </nav>
        </div>
        {memberTab === "teachers" && <p className="row-sub members-hint">★ marks the class teacher, who takes attendance.</p>}
        {MEMBER_GROUPS.filter(([group]) => group === memberTab).map(([group, title]) => {
          const list = members.filter((m) => memberGroup(m) === group).sort((x, y) => (x.full_name || x.email).localeCompare(y.full_name || y.email));
          if (!list.length) return <p key={group} className="row-sub members-empty">{loading ? "Loading…" : `No ${title.toLowerCase()} yet.`}</p>;
          return (
            <div key={group} className="member-group">
        {list.map((m) => (
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
            onClassTeacher={async (a) => {
              try {
                await setClassTeacher(a.id, !a.is_class_teacher);
                await load();
              } catch {
                setError(
                  `${gradeLabel(a.class)}${a.section ? ` · ${a.section}` : ""} already has a class teacher. Remove the star from them first.`
                );
              }
            }}
            canAssign={Boolean(session)}
          />
        ))}
            </div>
          );
        })}
        <AddMember
          key={memberTab}
          onAdd={act((email, role, details) => addMember(school.id, email, role, details))}
          existing={members}
          defaultRole={memberTab === "lead" ? "admin" : "teacher"}
          defaultDesignation={memberTab === "teachers" ? "Teacher" : ""}
        />
      </section>
    </>
  );
}

// Members are listed in three groups: teachers, the school's leadership
// (owner, admins, principal, director), and other staff (front desk,
// accounts, library…). Teachers with no designation count as teachers.
const MEMBER_GROUPS = [
  ["teachers", "Teachers", "Teachers"],
  ["lead", "Admin & principal", "Admin"],
  ["others", "Other staff", "Others"],
];
const memberGroup = (m) => {
  const d = m.designation ?? "";
  if (m.role === "owner" || m.role === "admin" || m.role === "principal" || /principal|director|vice/i.test(d)) return "lead";
  if (!d.trim() || /teach|coordinator|hod|pgt|tgt|prt|lecturer|faculty|incharge|in-charge/i.test(d)) return "teachers";
  return "others";
};

function RolePicker({ value, onChange, disabled }) {
  return (
    <select className="select" value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} title={ROLE_HINT[value]}>
      {["teacher", "admin", "principal"].map((r) => (
        <option key={r} value={r} title={ROLE_HINT[r]}>
          {ROLE_LABEL[r]}
        </option>
      ))}
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
    <div className="join-inline" title="Staff sign in with Google and enter this code. You approve them in Staff, App access.">
      <span className="join-label">Join code</span>
      <div className="join-code-row">
        <code className="join-code">{code}</code>
        <button className="btn btn-secondary btn-sm" onClick={copy}>
          {state === "copied" ? "Copied" : "Copy"}
        </button>
        {state === "confirm" ? (
          <>
            <button className="btn btn-secondary btn-sm" onClick={() => setState("idle")}>
              Cancel
            </button>
            <button className="btn btn-danger btn-sm" onClick={regenerate} title="The old code will stop working">
              New code, old one stops
            </button>
          </>
        ) : (
          <button className="btn btn-secondary btn-sm" onClick={() => setState("confirm")} disabled={state === "busy"}>
            New code
          </button>
        )}
        {state === "error" && <span className="field-error">Couldn’t change the code.</span>}
      </div>
    </div>
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
      <Photo person={{ ...request, name: request.name || request.email }} className="request-photo" />
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

function MemberRow({ member, isMe, classes, assignments, onRole, onRemove, onAssign, onUnassign, onClassTeacher, canAssign }) {
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
        {member.role === "teacher" && (
          <div className="chips">
            {assignments.map((a) => (
              <span key={a.id} className={`chip${a.is_class_teacher ? " chip-ct" : ""}`}>
                <button
                  className="chip-star"
                  aria-pressed={a.is_class_teacher}
                  title={a.is_class_teacher ? "Class teacher (marks attendance). Tap to remove." : "Make class teacher"}
                  aria-label={a.is_class_teacher ? "Remove as class teacher" : "Make class teacher"}
                  onClick={() => onClassTeacher(a)}
                >
                  {a.is_class_teacher ? "★" : "☆"}
                </button>
                {gradeLabel(a.class)}
                {a.section ? ` · ${a.section}` : " · all"}
                {a.is_class_teacher && <span className="chip-ct-label">Class teacher</span>}
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
            {!assignments.length && <span className="row-sub">No classes yet</span>}
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

// A button first; the form opens when needed.
function AddMember({ onAdd, existing, defaultRole = "teacher", defaultDesignation = "" }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [designation, setDesignation] = useState(defaultDesignation);
  const [role, setRole] = useState(defaultRole);
  const duplicate = existing.some((m) => m.email === email.trim().toLowerCase());
  if (!open) {
    return (
      <div className="row row-add">
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setOpen(true)}>
          <Icon name="plus" />
          Add someone
        </button>
      </div>
    );
  }
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
        setOpen(false);
      }}
    >
      <input className="input" type="email" required autoFocus placeholder="Google email" value={email} onChange={(e) => setEmail(e.target.value)} />
      <input className="input" placeholder="Full name" value={fullName} onChange={(e) => setFullName(e.target.value)} maxLength={120} />
      <input className="input" placeholder="Designation" value={designation} onChange={(e) => setDesignation(e.target.value)} maxLength={80} />
      <RolePicker value={role} onChange={setRole} />
      <button type="button" className="btn btn-secondary btn-sm" onClick={() => setOpen(false)}>
        Cancel
      </button>
      <button className="btn btn-primary btn-sm" disabled={!email || duplicate}>
        Add
      </button>
      {duplicate && <span className="row-sub">Already a member.</span>}
    </form>
  );
}
