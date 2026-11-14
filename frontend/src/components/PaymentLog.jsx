import { useCallback, useEffect, useMemo, useState } from "react";
import { listPaymentLog } from "../data/api.js";
import { deviceName } from "../data/device.js";
import { downloadCsv } from "../data/exportCsv.js";
import { METHODS, rupees } from "../data/money.js";
import Icon from "./Icon.jsx";

const PAGE = 100;
const when = (t) =>
  new Date(t).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit" });
const dayOf = (t) => new Date(t).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
const timeOf = (t) => new Date(t).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
const DEVICE_LABELS = {
  app: "Opened in",
  platform: "Platform",
  mobile: "Phone or tablet",
  screen: "Screen",
  window: "Window",
  pixel_ratio: "Pixel ratio",
  language: "Language",
  time_zone: "Time zone",
  local_time: "Device clock",
  online: "Online",
  cores: "CPU cores",
  memory_gb: "Memory (GB)",
};

// Owners: every payment received or cancelled, written by the database as it
// happens: when, who was signed in, who collected the money, and the device
// and network it came from. Nobody can edit it.
export default function PaymentLog({ school, header }) {
  const [rows, setRows] = useState([]);
  const [more, setMore] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [event, setEvent] = useState("all");
  const [open, setOpen] = useState(null);

  const load = useCallback(
    async (from = 0) => {
      setLoading(true);
      try {
        const page = await listPaymentLog(school.id, { from, size: PAGE });
        setRows((r) => (from ? [...r, ...page] : page));
        setMore(page.length === PAGE);
        setError("");
      } catch (err) {
        setError(err?.code === "PGRST205" ? "The payment log isn’t live yet: the latest database update needs to be applied." : "Couldn’t load the payment log.");
      } finally {
        setLoading(false);
      }
    },
    [school.id]
  );

  useEffect(() => {
    load(0);
  }, [load]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter(
      (r) =>
        (event === "all" || r.event === event) &&
        (!q ||
          [r.student?.name, r.student?.admission_no, r.receipt_no, r.user_email, r.collected_by, r.reference, r.ip]
            .filter(Boolean)
            .some((v) => String(v).toLowerCase().includes(q)))
    );
  }, [rows, query, event]);

  const days = useMemo(() => {
    const out = [];
    for (const r of shown) {
      const d = dayOf(r.at);
      if (out.at(-1)?.day !== d) out.push({ day: d, rows: [] });
      out.at(-1).rows.push(r);
    }
    return out;
  }, [shown]);

  function download() {
    downloadCsv(
      ["Logged at", "Event", "Amount", "Method", "Reference", "Receipt no.", "Paid on", "Student", "Reg no.", "Collected by", "Signed in as", "IP address", "Device", "Browser (full)", "Device details", "Note"],
      shown.map((r) => [
        new Date(r.at).toISOString(),
        r.event,
        Number(r.amount),
        METHODS[r.method] ?? r.method,
        r.reference,
        r.receipt_no,
        r.paid_on,
        r.student?.name,
        r.student?.admission_no,
        r.collected_by,
        r.user_email,
        r.ip,
        deviceName(r.user_agent ?? ""),
        r.user_agent,
        r.device ? JSON.stringify(r.device) : "",
        r.note,
      ]),
      `${school.slug ?? "school"}-payment-log.csv`
    );
  }

  return (
    <>
      {header(
        <button className="btn btn-secondary btn-sm" onClick={download} disabled={!shown.length}>
          <Icon name="download" />
          Download CSV
        </button>
      )}
      <div className="plog">
        <div className="plog-tools">
          <label className="plog-search">
            <Icon name="search" size={16} />
            <input
              className="input"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Student, receipt, collected by, email or IP"
              aria-label="Search the payment log"
            />
          </label>
          <div className="segmented segmented-sm" role="radiogroup" aria-label="Show">
            {[
              ["all", "All"],
              ["received", "Received"],
              ["cancelled", "Cancelled"],
            ].map(([v, l]) => (
              <button key={v} type="button" role="radio" aria-checked={event === v} className={event === v ? "active" : ""} onClick={() => setEvent(v)}>
                {l}
              </button>
            ))}
          </div>
        </div>

        {error && <p className="notice notice-error">{error}</p>}
        {!error && !loading && !shown.length && <p className="row-sub plog-empty">{rows.length ? "Nothing matches." : "No payments logged yet."}</p>}

        {days.map((d) => (
          <section key={d.day} className="plog-day">
            <h3 className="fees2-title">{d.day}</h3>
            <ul className="fees2-card plog-list">
              {d.rows.map((r) => (
                <LogRow key={r.id} row={r} open={open === r.id} onToggle={() => setOpen(open === r.id ? null : r.id)} />
              ))}
            </ul>
          </section>
        ))}

        {more && !error && rows.length > 0 && (
          <button className="btn btn-secondary plog-more" onClick={() => load(rows.length)} disabled={loading}>
            {loading ? "Loading…" : "Show older"}
          </button>
        )}
        {loading && !rows.length && <p className="row-sub plog-empty">Loading…</p>}
      </div>
    </>
  );
}

function LogRow({ row: r, open, onToggle }) {
  const cancelled = r.event === "cancelled";
  const device = deviceName(r.user_agent ?? "");
  const details = [
    ["Logged at", when(r.at)],
    ["Event", cancelled ? "Payment cancelled" : "Payment received"],
    ["Amount", rupees(r.amount)],
    ["Method", [METHODS[r.method] ?? r.method, r.reference].filter(Boolean).join(" · ")],
    ["Receipt no.", r.receipt_no],
    ["Paid on (entered)", r.paid_on && new Date(r.paid_on).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })],
    ["Student", [r.student?.name, r.student?.admission_no && `#${r.student.admission_no}`].filter(Boolean).join(" ")],
    ["Collected by", r.collected_by],
    ["Signed in as", r.user_email ?? (r.user_id ? r.user_id : "System")],
    ["IP address", r.ip],
    ["Device", device],
    ["Browser (full)", r.user_agent],
    ...Object.entries(r.device ?? {})
      .filter(([, v]) => v !== null && v !== "")
      .map(([k, v]) => [DEVICE_LABELS[k] ?? k, typeof v === "boolean" ? (v ? "Yes" : "No") : String(v)]),
    ["Note", r.note],
  ].filter(([, v]) => v);

  return (
    <li className={open ? "is-open" : ""}>
      <button type="button" className={`plog-row${cancelled ? " is-cancelled" : ""}`} onClick={onToggle} aria-expanded={open}>
        <span className={`plog-icon${cancelled ? " is-cancelled" : ""}`} aria-hidden="true">
          <Icon name={cancelled ? "x" : "rupee"} size={15} />
        </span>
        <span className="plog-main">
          <strong>
            {rupees(r.amount)} {cancelled ? "cancelled" : "received"}
            <span className="plog-meta">{[METHODS[r.method] ?? r.method, r.receipt_no].filter(Boolean).join(" · ")}</span>
          </strong>
          <span className="row-sub">
            {[r.student?.name, r.collected_by ? `collected by ${r.collected_by}` : null, r.user_email ? `entered by ${r.user_email}` : null]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </span>
        <span className="plog-side">
          <strong>{timeOf(r.at)}</strong>
          <span className="row-sub">{r.user_agent ? device : r.ip ?? ""}</span>
        </span>
        <Icon name="chevronDown" size={16} />
      </button>
      {open && (
        <dl className="plog-details">
          {details.map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      )}
    </li>
  );
}
