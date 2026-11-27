import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { listExportRequests, requestExport, consumeExportRequest, listFeeHeads, listPlans, listSchedule } from "../data/api.js";
import { downloadStudentsCsv } from "../data/exportCsv.js";
import { bestLine } from "../data/feeDues.js";
import StudentPicker, { describePicked } from "./StudentPicker.jsx";
import { gradeRank } from "./GradeFilter.jsx";
import Icon from "./Icon.jsx";

const GENDERS = [["M", "Boys"], ["F", "Girls"], ["", "Not set"]];
const byClass = (a, b) =>
  gradeRank(a.class ?? "") - gradeRank(b.class ?? "") ||
  (a.section ?? "").localeCompare(b.section ?? "") ||
  (a.name ?? "").localeCompare(b.name ?? "");
const genderRank = (p) => ({ M: 0, F: 1 })[p.gender] ?? 2;
const byGender = (a, b) => genderRank(a) - genderRank(b) || byClass(a, b);
const FREQUENCY = { monthly: "Monthly", quarterly: "Quarterly", half_yearly: "Half-yearly", annual: "Annual", one_time: "One time" };

// One column per fee in the session's structure (Tuition, Transport…): the
// student's amount per instalment, by grade or by bus stop. None if fees
// can't be read, so the export still works.
async function feeColumns(schoolId, sessionId) {
  if (!sessionId) return [];
  try {
    const [heads, plans, schedule] = await Promise.all([listFeeHeads(schoolId), listPlans(schoolId), listSchedule(sessionId)]);
    return heads.flatMap((h) => {
      const lines = schedule.filter((l) => l.head_id === h.id && Number(l.amount) > 0);
      if (!lines.length) return [];
      const often = [...new Set(lines.map((l) => (l.plan_id ? plans.find((p) => p.id === l.plan_id)?.name : FREQUENCY[l.frequency])))];
      return [{ header: often.length === 1 && often[0] ? `${h.name} (${often[0]})` : h.name, amount: (p) => bestLine(lines, p)?.amount ?? "" }];
    });
  } catch {
    return [];
  }
}

// Owners pick and download. Admins pick and request; once the owner approves,
// one download of exactly that list is allowed. Teachers don't get this button.
// people: everyone this session. preselect: who's showing under the filters.
export default function ExportButton({ school, sessionId, role, people, preselect, label }) {
  const [requests, setRequests] = useState([]);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const isOwner = role === "owner";
  const filename = `${school.slug}-${label}-${new Date().toISOString().slice(0, 10)}.csv`;
  const download = async (list) => downloadStudentsCsv(list, filename, await feeColumns(school.id, sessionId));

  const refresh = useCallback(async () => {
    if (isOwner) return;
    try {
      setRequests(await listExportRequests(school.id));
    } catch {
      setRequests([]);
    }
  }, [isOwner, school.id]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const approved = requests.find((r) => r.status === "approved");
  const pending = requests.find((r) => r.status === "pending");

  async function run(fn) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch {
      setError("Couldn’t complete that. Try again.");
    } finally {
      setBusy(false);
      refresh();
    }
  }

  if (approved) {
    // Older requests have no list: they cover everyone. The ids are in the
    // order the file was asked for.
    const byId = new Map(people.map((p) => [p.id, p]));
    const list = approved.student_ids ? approved.student_ids.map((id) => byId.get(id)).filter(Boolean) : people;
    return (
      <div className="popover-anchor">
        <button
          className="btn btn-secondary is-active"
          disabled={busy}
          onClick={() =>
            // Not used up if none of them are in the session on screen
            list.length
              ? run(async () => {
                  if (await consumeExportRequest(approved.id)) await download(list);
                  else setError("That approval was already used.");
                })
              : setError("Those students aren’t in this session.")
          }
          title={`Approved by the owner: ${approved.selection ?? "all students"}. Works once.`}
        >
          <Icon name="download" />
          <span className="btn-label">Download export</span>
        </button>
        {error && <p className="field-error">{error}</p>}
      </div>
    );
  }

  if (pending) {
    return (
      <button className="btn btn-secondary" disabled title={`Waiting for the owner to approve: ${pending.selection ?? "all students"}`}>
        <Icon name="download" />
        <span className="btn-label">Export requested</span>
      </button>
    );
  }

  return (
    <>
      <button className="btn btn-secondary" onClick={() => setPicking(true)} disabled={!people.length} aria-haspopup="dialog" aria-label={isOwner ? "Export" : "Request export"} title={isOwner ? "Export" : "Request export"}>
        <Icon name="download" />
        <span className="btn-label">Export</span>
      </button>
      {picking && (
        <ExportPicker
          people={people}
          preselect={preselect}
          isOwner={isOwner}
          busy={busy}
          error={error}
          onClose={() => setPicking(false)}
          onDone={(list, selection, reason) =>
            run(async () => {
              if (isOwner) await download(list);
              else await requestExport(school.id, reason, list.map((p) => p.id), selection);
              setPicking(false);
            })
          }
        />
      )}
    </>
  );
}

// Who to export. Starts from whoever the page's filters are showing.
function ExportPicker({ people, preselect, isOwner, busy, error, onClose, onDone }) {
  const [picked, setPicked] = useState(() => new Set(preselect.map((p) => p.id)));
  const [reason, setReason] = useState("");
  const [gender, setGender] = useState(null);
  const [order, setOrder] = useState("class");
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  // Picking a gender narrows the classes and students below to it
  const matching = (p) => gender === null || (p.gender ?? "") === gender;
  const shown = people.filter(matching);
  const list = shown.filter((p) => picked.has(p.id)).sort(order === "gender" ? byGender : byClass);
  const count = list.length;
  const genderWord = GENDERS.find(([v]) => v === gender)?.[1];
  const chip = (on, label, onClick) => (
    <button key={label} type="button" className={`chip-btn${on ? " is-on" : ""}`} onClick={onClick} aria-pressed={on}>
      {label}
    </button>
  );
  const words = `${count.toLocaleString("en-IN")} ${count === 1 ? "student" : "students"}`;

  return createPortal(
    <div className="filter-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <section className="filter-sheet" role="dialog" aria-modal="true" aria-label={isOwner ? "Export students" : "Request export"}>
        <header className="filter-head">
          <h2>{isOwner ? "Export students" : "Request export"}</h2>
          <button type="button" className="btn-icon" onClick={onClose} aria-label="Close" title="Close">
            <Icon name="x" size={18} />
          </button>
        </header>
        <div className="filter-body">
          <h3>Arrange by</h3>
          <div className="filter-chips">
            {chip(order === "class", "Class", () => setOrder("class"))}
            {chip(order === "gender", "Gender", () => setOrder("gender"))}
          </div>
          <h3>Gender</h3>
          <div className="filter-chips">
            {chip(gender === null, "All", () => setGender(null))}
            {GENDERS.filter(([v]) => people.some((p) => (p.gender ?? "") === v)).map(([v, label]) => chip(gender === v, label, () => setGender(v)))}
          </div>
          <StudentPicker people={shown} picked={picked} onChange={setPicked} />
          {!isOwner && <input className="input export-find export-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} placeholder="What is it for? e.g. Board registration" aria-label="What is it for?" />}
          {error && <p className="field-error">{error}</p>}
        </div>
        <footer className="filter-foot">
          <button type="button" className="link-btn" onClick={() => setPicked(new Set())} disabled={!count}>
            Clear all
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!count || busy}
            onClick={() =>
              onDone(
                list,
                `${describePicked(shown, new Set(list.map((p) => p.id)))}${genderWord ? ` · ${genderWord}` : ""}`.slice(0, 200),
                reason.trim() || null
              )
            }
          >
            {isOwner ? `Download ${words}` : `Request ${words}`}
          </button>
        </footer>
      </section>
    </div>,
    document.body
  );
}
