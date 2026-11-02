import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { gradeLabel } from "./PersonCard.jsx";
import Icon from "./Icon.jsx";

// Students page: one button in place of the row of filters. It opens a panel
// with the grades, the sort and "show only"; changes apply straight away, and
// the button counts what's on (the direction is SortArrow, beside it). grades: gradeOptions(); sort: { by, dir } or
// null; withSort, withFee and onSlc depend on what this person can use.
const SORT_START = { grade: "asc", fee: "desc", perf: "asc" };
const SORT_FIRST = {
  grade: { asc: "Junior first", desc: "Senior first" },
  fee: { asc: "Least due", desc: "Most due" },
  perf: { asc: "Lowest first", desc: "Highest first" },
};

// The sort's direction, in the toolbar. On the default order it flips that:
// the biggest dues first for the office, the lowest results first for others.
export function SortArrow({ sort, onSort, withFee }) {
  const now = sort ?? (withFee ? { by: "fee", dir: "desc" } : { by: "perf", dir: "asc" });
  const flip = now.dir === "asc" ? "desc" : "asc";
  return (
    <button
      type="button"
      className={`btn btn-secondary sort-arrow${sort ? " is-active" : ""}`}
      onClick={() => onSort({ by: now.by, dir: flip })}
      aria-label={`${SORT_FIRST[now.by][now.dir]}. Switch to ${SORT_FIRST[now.by][flip].toLowerCase()}`}
      title={SORT_FIRST[now.by][now.dir]}
    >
      <Icon name={now.dir === "desc" ? "arrowDown" : "arrowUp"} />
    </button>
  );
}

export default function FilterSheet({ grades, picked, onPick, sort, onSort, withSort, withFee, slc, onSlc, shown }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const on = (picked.length ? 1 : 0) + (sort ? 1 : 0) + (slc ? 1 : 0);
  const toggle = (g) => onPick(grades.map((o) => o.value).filter((v) => (v === g ? !picked.includes(v) : picked.includes(v))));
  const clear = () => {
    onPick([]);
    onSort(null);
    onSlc?.(false);
  };
  const sorts = [["", "Default"], ["grade", "Grade"], ...(withFee ? [["fee", "Fee due"]] : []), ["perf", "Results"]];
  const sortChip = ([by, label]) => (
    <button
      key={by}
      type="button"
      className={`chip-btn${(sort?.by ?? "") === by ? " is-on" : ""}`}
      // The direction carries over from one sort to the next
      onClick={() => onSort(by ? { by, dir: sort?.dir ?? SORT_START[by] } : null)}
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
