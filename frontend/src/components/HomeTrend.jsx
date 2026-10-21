import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { attendanceOverview, loadAttendance, paymentsSince } from "../data/api.js";
import { peek, swr } from "../data/cache.js";
import { rupees, rupeesShort } from "../data/money.js";

// The bigger top card on Home (computers): one number with a plain
// sentence comparing it to last time, and one simple chart beside it.
// Owners and admins: fees collected so far this month (a running total,
// last month as a dashed line). Principal and class teachers: attendance
// each day this week. Other teachers: homework set each day this week.

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const monday = (d) => addDays(d, -((d.getDay() + 6) % 7));
const n = (v) => Number(v || 0).toLocaleString("en-IN");
const sum = (list) => list.reduce((t, v) => t + (v ?? 0), 0);
const weekday = (d) => d.toLocaleDateString("en-IN", { weekday: "short" });

// Computers only (the chart needs room; phones keep the slim card).
export function useWide(query = "(min-width: 761px)") {
  const [wide, setWide] = useState(() => typeof window !== "undefined" && window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setWide(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [query]);
  return wide;
}

// This week's days (Mon to Sat, or to Sun with `sunday`) and last week's.
function weekDays(sunday = false) {
  const now = new Date();
  const start = monday(now);
  const count = sunday ? 7 : 6;
  const days = Array.from({ length: count }, (_, i) => addDays(start, i));
  const before = days.map((d) => addDays(d, -7));
  const todayIdx = days.findIndex((d) => iso(d) === iso(now));
  return { days, before, todayIdx: todayIdx === -1 ? count - 1 : todayIdx };
}

// "₹2.5 L less than this time last month", "3 more than last week"…
function compare(cur, prev, { fmt = n, than }) {
  if (cur === null || prev === null) return null;
  const diff = cur - prev;
  if (Math.round(diff) === 0) return { dir: "flat", text: `Same as ${than}` };
  return { dir: diff > 0 ? "up" : "down", text: `${fmt(Math.abs(diff))} ${diff > 0 ? "more" : "less"} than ${than}` };
}

// Fees collected so far this month, against last month by the same day.
export function useFeeTrend(schoolId, enabled) {
  const now = new Date();
  const from = iso(new Date(now.getFullYear(), now.getMonth() - 1, 1));
  const key = `fee-trend:${schoolId}:${from}`;
  const [rows, setRows] = useState(() => peek(key) ?? null);
  useEffect(() => {
    if (!enabled) return;
    swr(key, () => paymentsSince(schoolId, from), setRows, { persist: true, maxAge: 120000 }).catch(() => setRows([]));
  }, [enabled, key, schoolId, from]);
  if (!enabled) return null;
  if (rows === null) return { loading: true };

  const y = now.getFullYear();
  const m = now.getMonth();
  const length = new Date(y, m + 1, 0).getDate();
  const lastLength = new Date(y, m, 0).getDate();
  const today = now.getDate();
  const daily = Array(length).fill(0);
  const lastDaily = Array(lastLength).fill(0);
  let payments = 0;
  const thisMonth = iso(now).slice(0, 7);
  for (const r of rows) {
    const day = Number(r.paid_on.slice(8, 10)) - 1;
    if (r.paid_on.slice(0, 7) === thisMonth) {
      if (day < today) {
        daily[day] += Number(r.amount);
        payments++;
      }
    } else lastDaily[day] += Number(r.amount);
  }
  const running = (list) => {
    let t = 0;
    return list.map((v) => (t += v));
  };
  const cur = running(daily).slice(0, today);
  const prev = running(lastDaily);
  const collected = cur[today - 1] ?? 0;
  const byDay = Math.min(today, lastLength);
  const lastByNow = prev[byDay - 1] ?? 0;
  const month = (k, opts = { month: "short" }) => new Date(y, m + k, 1).toLocaleDateString("en-IN", opts);

  return {
    label: "Collected this month",
    value: rupees(collected),
    note: compare(collected, lastByNow, { fmt: rupeesShort, than: "this time last month" }),
    extra: payments ? `From ${n(payments)} payment${payments === 1 ? "" : "s"}` : "No payments yet this month",
    chart: {
      kind: "line",
      cur,
      prev,
      days: Math.max(length, lastLength),
      curName: month(0, { month: "long" }),
      prevName: month(-1, { month: "long" }),
      dayName: (i, k) => `${i + 1} ${month(k)}`,
      fmt: rupees,
      axis: rupeesShort,
    },
  };
}

// Attendance each day this week (present %, Mon to Sat).
// students: a teacher's own students (leads see the whole school).
export function useAttendanceTrend(sessionId, leads, students, today, enabled) {
  const { days, before, todayIdx } = weekDays();
  const all = [...before, ...days.slice(0, todayIdx + 1)].map(iso);
  const key = `att-trend:${sessionId}:${leads ? "all" : "mine"}:${all[0]}:${all.length}`;
  const [byDay, setByDay] = useState(() => peek(key) ?? null);
  const mine = leads ? null : new Set(students.map((p) => p.id));
  const mineKey = leads ? "" : students.length;
  useEffect(() => {
    if (!enabled || !sessionId) return;
    const one = async (day) => {
      if (leads) {
        const rows = await attendanceOverview(sessionId, day);
        const marked = rows.reduce((t, r) => t + Number(r.students) - Number(r.unmarked), 0);
        const present = rows.reduce((t, r) => t + Number(r.present) + Number(r.late), 0);
        return { marked, present };
      }
      const rows = (await loadAttendance(sessionId, day)).filter((r) => mine.has(r.student_id));
      return { marked: rows.length, present: rows.filter((r) => r.status === "present" || r.status === "late").length };
    };
    swr(key, () => Promise.all(all.map(one)).then((list) => Object.fromEntries(all.map((d, i) => [d, list[i]]))), setByDay, {
      persist: true,
      maxAge: 300000,
    }).catch(() => setByDay({}));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, key, sessionId, leads, mineKey]);
  if (!enabled) return null;
  if (byDay === null) return { loading: true };

  const pct = (d, isToday) => {
    // Today's numbers come live from the page above
    const v = isToday && today?.marked ? today : byDay[iso(d)];
    return v?.marked ? Math.round((v.present / v.marked) * 100) : null;
  };
  const cur = days.map((d, i) => (i > todayIdx ? null : pct(d, i === todayIdx)));
  const prev = before.map((d) => pct(d));
  const avg = (list) => {
    const v = list.filter((x) => x !== null);
    return v.length ? Math.round(sum(v) / v.length) : null;
  };
  const weekAvg = avg(cur);
  const lastAvg = avg(prev.slice(0, todayIdx + 1));
  return {
    label: "Present this week",
    value: weekAvg === null ? "–" : `${weekAvg}%`,
    note: compare(weekAvg, lastAvg, { fmt: (v) => `${v} point${v === 1 ? "" : "s"}`, than: "last week" }),
    extra: today?.marked ? `${n(today.absent)} absent today` : null,
    chart: { kind: "bars", values: cur, labels: days.map(weekday), todayIdx, max: 100, fmt: (v) => `${v}%` },
  };
}

// Homework set each day this week (Mon to Sun).
export function homeworkTrend(homework) {
  if (homework === null) return { loading: true };
  const { days, before, todayIdx } = weekDays(true);
  const count = (d) => homework.filter((h) => h.created_at && iso(new Date(h.created_at)) === iso(d)).length;
  const cur = days.map((d, i) => (i > todayIdx ? null : count(d)));
  const set = sum(cur);
  const lastSet = sum(before.slice(0, todayIdx + 1).map(count));
  const tomorrow = iso(addDays(new Date(), 1));
  const dueTomorrow = homework.filter((h) => h.due_date === tomorrow).length;
  return {
    label: "Homework set this week",
    value: n(set),
    note: compare(set, lastSet, { than: "last week" }),
    extra: dueTomorrow ? `${n(dueTomorrow)} due tomorrow` : null,
    chart: { kind: "bars", values: cur, labels: days.map(weekday), todayIdx, fmt: n },
  };
}

// A clean axis top: 1, 2, 2.5 or 5 times a power of ten, in two steps.
function niceTop(max) {
  if (max <= 0) return 1;
  const pow = 10 ** Math.floor(Math.log10(max));
  return [1, 2, 2.5, 5, 10].find((s) => s * pow * 2 >= max) * pow * 2;
}

function useWidth() {
  const ref = useRef(null);
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

const pathOf = (pts) => pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");

// Running total: this month solid with a soft fill, last month dashed.
// Each line is named at its end, so there's no legend to decode.
function LineChart({ cur, prev, days, curName, prevName, dayName, fmt, axis }) {
  const [ref, W] = useWidth();
  const [hover, setHover] = useState(null);
  const H = 180;
  const pad = { t: 14, r: 120, b: 24, l: 50 };
  const top = niceTop(Math.max(1, ...cur, ...prev));
  const x = (i) => pad.l + ((W - pad.l - pad.r) * i) / Math.max(1, days - 1);
  const y = (v) => pad.t + (H - pad.t - pad.b) * (1 - v / top);
  const curPts = cur.map((v, i) => [x(i), y(v)]);
  const prevPts = prev.map((v, i) => [x(i), y(v)]);
  const last = curPts[curPts.length - 1];
  const prevEnd = prevPts[prevPts.length - 1];
  const ticks = [0, Math.floor(days / 2) - 1, days - 1];

  const onMove = (e) => {
    const box = e.currentTarget.getBoundingClientRect();
    const i = Math.round(((e.clientX - box.left - pad.l) / (W - pad.l - pad.r)) * (days - 1));
    setHover(i >= 0 && i < days ? i : null);
  };

  return (
    <div className="trend-chart" ref={ref}>
      {W > 0 && (
        <svg
          width={W}
          height={H}
          onMouseMove={onMove}
          onMouseLeave={() => setHover(null)}
          role="img"
          aria-label={`${curName} so far ${fmt(cur[cur.length - 1] ?? 0)}; ${prevName} in all ${fmt(prev[prev.length - 1] ?? 0)}`}
        >
          {[0.5, 1].map((t) => (
            <g key={t}>
              <line x1={pad.l} x2={W - pad.r} y1={y(top * t)} y2={y(top * t)} className="trend-grid" />
              <text x={pad.l - 8} y={y(top * t) + 4} className="trend-axis" textAnchor="end">
                {axis(top * t)}
              </text>
            </g>
          ))}
          <line x1={pad.l} x2={W - pad.r} y1={y(0)} y2={y(0)} className="trend-base" />
          {ticks.map((i) => (
            <text key={i} x={x(i)} y={H - 6} className="trend-axis" textAnchor={i === 0 ? "start" : i === days - 1 ? "end" : "middle"}>
              {dayName(i, 0)}
            </text>
          ))}

          {prevPts.length > 1 && <path d={pathOf(prevPts)} className="trend-line-prev" />}
          {curPts.length > 0 && <path d={`${pathOf(curPts)} L${last[0]},${y(0)} L${curPts[0][0]},${y(0)} Z`} className="trend-area" />}
          {curPts.length > 1 && <path d={pathOf(curPts)} className="trend-line" />}

          {prevEnd && (
            <text x={prevEnd[0] + 10} y={prevEnd[1] + 4} className="trend-end is-prev">
              {prevName}
            </text>
          )}
          {last && (
            <>
              <circle cx={last[0]} cy={last[1]} r="5" className="trend-dot" />
              <text x={last[0] + 10} y={last[1] - 8} className="trend-end">
                {curName} so far
              </text>
            </>
          )}

          {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={y(0)} className="trend-cross" />}
        </svg>
      )}
      {hover !== null && (
        <div className="trend-tip" style={{ left: Math.min(Math.max(x(hover), 90), W - 90) }}>
          {hover < cur.length && (
            <span>
              {dayName(hover, 0)} <b>{fmt(cur[hover])}</b>
            </span>
          )}
          {hover < prev.length && (
            <span className="is-muted">
              {dayName(hover, -1)} <b>{fmt(prev[hover])}</b>
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// One bar per day with its number on top. Days still to come are an
// empty outline; a day with nothing marked shows a dash.
function BarChart({ values, labels, todayIdx, max, fmt }) {
  const [ref, W] = useWidth();
  const H = 180;
  const pad = { t: 24, b: 26 };
  const top = max ?? niceTop(Math.max(1, ...values.map((v) => v ?? 0)));
  const band = W / values.length;
  const bw = Math.min(56, band * 0.55);
  const y = (v) => pad.t + (H - pad.t - pad.b) * (1 - Math.min(v, top) / top);
  const base = H - pad.b;

  return (
    <div className="trend-chart" ref={ref}>
      {W > 0 && (
        <svg width={W} height={H} role="img" aria-label={values.map((v, i) => `${labels[i]} ${v === null ? "none" : fmt(v)}`).join(", ")}>
          <line x1={0} x2={W} y1={base} y2={base} className="trend-base" />
          {values.map((v, i) => {
            const cx = band * i + band / 2;
            const future = i > todayIdx;
            const h = v ? Math.max(4, base - y(v)) : 0;
            return (
              <g key={i}>
                {future ? (
                  <rect x={cx - bw / 2} y={base - 28} width={bw} height={28} rx="8" className="trend-bar-future" />
                ) : (
                  h > 0 && <rect x={cx - bw / 2} y={base - h} width={bw} height={h} rx="8" className={`trend-bar${i === todayIdx ? " is-today" : ""}`} />
                )}
                {!future && (
                  <text x={cx} y={(h > 0 ? base - h : base) - 8} className="trend-value" textAnchor="middle">
                    {v === null ? "–" : fmt(v)}
                  </text>
                )}
                <text x={cx} y={H - 6} className={`trend-axis${i === todayIdx ? " is-today" : ""}`} textAnchor="middle">
                  {i === todayIdx ? "Today" : labels[i]}
                </text>
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
}

export function TrendPanel({ trend }) {
  if (!trend) return null;
  if (trend.loading) return <div className="home-trend is-loading" aria-busy="true" />;
  const { label, value, note, extra, chart } = trend;
  return (
    <div className="home-trend">
      <div className="trend-stat">
        <span className="trend-label">{label}</span>
        <strong className="trend-value-big">{value}</strong>
        {note && <span className={`trend-note is-${note.dir}`}>{note.text}</span>}
        {extra && <span className="trend-extra">{extra}</span>}
      </div>
      {chart.kind === "line" ? <LineChart {...chart} /> : <BarChart {...chart} />}
    </div>
  );
}
