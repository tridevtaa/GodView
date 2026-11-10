import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { gradeLabel } from "./PersonCard.jsx";
import Icon from "./Icon.jsx";

// Students page: one button in place of the row of filters. It opens a panel
// with the grades, the sort, active or inactive and "show only"; changes apply straight away, and
// the button counts what's on (the direction is SortArrow, beside it). grades: gradeOptions(); sort is
// always one of grade, fee or results — withSort, withFee and onSlc depend on what this person can use.
const SORT_START = { grade: "asc", fee: "desc", perf: "asc" };
const SORT_FIRST = {
  grade: { asc: "Junior first", desc: "Senior first" },
  fee: { asc: "Least due", desc: "Most due" },
  perf: { asc: "Lowest first", desc: "Highest first" },
};

// The sort's direction, in the toolbar.
export function SortArrow({ sort, onSort }) {
  const nextDir = sort.dir === "asc" ? "desc" : "asc";
  return (
    <button
      type="button"
      className="btn btn-secondary sort-arrow is-active"
      onClick={() => onSort({ by: sort.by, dir: nextDir })}
      aria-label={`${SORT_FIRST[sort.by][sort.dir]}. Switch to ${SORT_FIRST[sort.by][nextDir].toLowerCase()}`}
      title={SORT_FIRST[sort.by][sort.dir]}
    >
      <Icon name={sort.dir === "desc" ? "arrowDown" : "arrowUp"} />
    </button>
  );
}

export default function FilterSheet({ grades, picked, onPick, sort, onSort, withSort, withFee, slc, onSlc, status, onStatus, shown }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const on = (picked.length ? 1 : 0) + (slc ? 1 : 0) + (status !== "active" ? 1 : 0);
  const toggle = (g) => onPick(grades.map((o) => o.value).filter((v) => (v === g ? !picked.includes(v) : picked.includes(v))));
  const clear = () => {
    onPick([]);
    onSlc?.(false);
    onStatus("active");
  };
  const sorts = [["grade", "Grade"], ...(withFee ? [["fee", "Fee due"]] : []), ["perf", "Results"]];
  const sortChip = ([by, label]) => (
    <button
      key={by}
      type="button"
      className={`chip-btn${sort.by === by ? " is-on" : ""}`}
      // The direction carries over from one sort to the next
      onClick={() => onSort({ by, dir: sort.by === by ? sort.dir : SORT_START[by] })}
    >
      {label}
    </button>
  );

  return (
    <>
      <button type="button" className={`btn btn-secondary${on ? " is-active" : ""}`} onClick={() => setOpen(true)} aria-haspopup="dialog">
        <Icon name="filter" />
        Filter &amp; sort
        {on > 0 && <span className="filter-count">{on}</span>}
      </button>
      {open &&
        createPortal(
          <div className="filter-back" onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
            <section className="filter-sheet" role="dialog" aria-modal="true" aria-label="Filter and sort">
              <header className="filter-head">
                <h2>Filter &amp; sort</h2>
                <button type="button" className="btn-icon" onClick={() => setOpen(false)} aria-label="Close" title="Close">
                  <Icon name="x" size={18} />
                </button>
              </header>
              <div className="filter-body">
                <h3>Grade</h3>
                <div className="filter-chips">
                  <button type="button" className={`chip-btn${picked.length ? "" : " is-on"}`} onClick={() => onPick([])}>
                    All
                  </button>
                  {grades.map((o) => (
                    <button key={o.value} type="button" className={`chip-btn${picked.includes(o.value) ? " is-on" : ""}`} onClick={() => toggle(o.value)}>
                      {gradeLabel(o.value)}
                    </button>
                  ))}
                </div>
                {withSort && (
                  <>
                    <h3>Sort by</h3>
                    <div className="filter-chips">
                      {sorts.map(sortChip)}
                    </div>
                  </>
                )}
                <h3>Status</h3>
                <div className="filter-chips">
                  {[["active", "Active"], ["inactive", "Inactive"]].map(([v, label]) => (
                    <button key={v} type="button" className={`chip-btn${status === v ? " is-on" : ""}`} onClick={() => onStatus(v)}>
                      {label}
                    </button>
                  ))}
                </div>
                {onSlc && (
                  <>
                    <h3>Show only</h3>
                    <div className="filter-chips">
                      <button
                        type="button"
                        className={`chip-btn${slc ? " is-on" : ""}`}
                        onClick={() => onSlc(!slc)}
                        title="Students still owing a transfer certificate"
                      >
                        SLC pending
                      </button>
                    </div>
                  </>
                )}
              </div>
              <footer className="filter-foot">
                <button type="button" className="link-btn" onClick={clear} disabled={!on}>
                  Clear all
                </button>
                <button type="button" className="btn btn-primary" onClick={() => setOpen(false)}>
                  Show {shown.toLocaleString("en-IN")} {shown === 1 ? "student" : "students"}
                </button>
              </footer>
            </section>
          </div>,
          document.body
        )}
    </>
  );
}
