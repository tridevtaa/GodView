import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { attendanceOverview, loadAttendance, paymentsSince } from "../data/api.js";
import { peek, swr } from "../data/cache.js";
import { rupees, rupeesShort } from "../data/money.js";
import Icon from "./Icon.jsx";

// The bigger top card on Home (computers): a few numbers on the left, and
// this period against the last one as bars on the right. Owners and admins
// see fees collected by day this month; the principal and class teachers
// see attendance by day this week; other teachers see homework set.

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const monday = (d) => addDays(d, -((d.getDay() + 6) % 7));
const n = (v) => Number(v || 0).toLocaleString("en-IN");
const sum = (list) => list.reduce((t, v) => t + (v ?? 0), 0);
const dayLabel = (d) => d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });

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

// Change against the last period, as a percent (or points for percents).
function change(cur, prev, { points = false, suffix } = {}) {
  if (cur === null || prev === null || prev === undefined) return null;
  const diff = points ? cur - prev : prev > 0 ? ((cur - prev) / prev) * 100 : null;
  if (diff === null) return null;
  const r = Math.round(diff);
  return { dir: r > 0 ? "up" : r < 0 ? "down" : "flat", text: r === 0 ? "Same" : `${Math.abs(r)}${points ? " pts" : "%"}`, suffix };
}

// This week's days (Mon to Sat, or Sun with `sunday`) and last week's.
function weekDays(sunday = false) {
  const now = new Date();
  const start = monday(now);
  const count = sunday ? 7 : 6;
  const days = Array.from({ length: count }, (_, i) => addDays(start, i));
  const before = days.map((d) => addDays(d, -7));
  const todayIdx = days.findIndex((d) => iso(d) === iso(now));
  return { days, before, todayIdx: todayIdx === -1 ? count - 1 : todayIdx, sundayNow: todayIdx === -1 };
}

// Fees collected by day: this month against last month.
export function useFeeTrend(schoolId, enabled) {
  const now = new Date();
  const from = iso(new Date(now.getFullYear(), now.getMonth() - 1, 1));
  const key = `fee-trend:${schoolId}:${from}`;
  const [rows, setRows] = useState(() => peek(key) ?? null);
  useEffect(() => {
    if (!enabled) return;
    swr(key, () => paymentsSince(schoolId, from), setRows, { persist: true, maxAge: 120000 }).catch(() => setRows([]));
  }, [enabled, key, schoolId, from]);
  if (!enabled || rows === null) return enabled ? { loading: true } : null;

  const y = now.getFullYear();
  const m = now.getMonth();
  const length = new Date(y, m + 1, 0).getDate();
  const lastLength = new Date(y, m, 0).getDate();
  const today = now.getDate();
  const cur = Array(length).fill(0);
  const prev = Array(length).fill(null);
  const curCount = Array(length).fill(0);
  const prevCount = Array(length).fill(0);
  for (let i = 0; i < Math.min(length, lastLength); i++) prev[i] = 0;
  const thisMonth = iso(new Date(y, m, 1)).slice(0, 7);
  for (const r of rows) {
    const day = Number(r.paid_on.slice(8, 10)) - 1;
    if (r.paid_on.slice(0, 7) === thisMonth) {
      cur[day] += Number(r.amount);
      curCount[day]++;
    } else if (day < length) {
      prev[day] += Number(r.amount);
      prevCount[day]++;
    }
  }
  for (let i = today; i < length; i++) cur[i] = null;

  const collected = sum(cur);
  const payments = sum(curCount.slice(0, today));
  const lastCollected = sum(prev.slice(0, today));
  const lastPayments = sum(prevCount.slice(0, today));
  const avg = payments ? collected / payments : 0;
  const lastAvg = lastPayments ? lastCollected / lastPayments : null;
  const monthName = (k) => new Date(y, m + k, 1).toLocaleDateString("en-IN", { month: "short" });
  return {
    stats: [
      { label: "Collected this month", value: rupeesShort(collected), delta: change(collected, lastCollected, { suffix: `vs ${monthName(-1)} 1 to ${today}` }) },
      { label: "Payments", value: n(payments), delta: change(payments, lastPayments) },
      { label: "Average payment", value: rupees(Math.round(avg)), delta: change(avg, lastAvg) },
    ],
    chart: {
      cur,
      prev,
      labels: cur.map((_, i) => String(i + 1)),
      titles: cur.map((_, i) => `${i + 1} ${monthName(0)}`),
      prevTitles: cur.map((_, i) => `${i + 1} ${monthName(-1)}`),
      tickEvery: 5,
      nowIdx: today - 1,
      curName: "This month",
      prevName: "Last month",
      fmt: rupees,
      axis: rupeesShort,
    },
  };
}

// Attendance by day (present %, Mon to Sat): this week against last week.
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
    stats: [
      { label: "Present this week", value: weekAvg === null ? "–" : `${weekAvg}%`, delta: change(weekAvg, lastAvg, { points: true, suffix: "vs last week" }) },
      { label: "Absent today", value: today?.marked ? n(today.absent) : "–" },
      { label: "On leave today", value: today?.marked ? n(today.leave) : "–" },
    ],
    chart: {
      cur,
      prev,
      labels: days.map((d) => d.toLocaleDateString("en-IN", { weekday: "short" })),
      titles: days.map(dayLabel),
      prevTitles: before.map(dayLabel),
      tickEvery: 1,
      nowIdx: todayIdx,
      curName: "This week",
      prevName: "Last week",
      max: 100,
      fmt: (v) => `${v}% present`,
      axis: (v) => `${v}%`,
    },
  };
}

// Homework set by day (Mon to Sun): this week against last week.
export function homeworkTrend(homework) {
  if (homework === null) return { loading: true };
  const { days, before, todayIdx } = weekDays(true);
  const count = (d) => homework.filter((h) => h.created_at && iso(new Date(h.created_at)) === iso(d)).length;
  const cur = days.map((d, i) => (i > todayIdx ? null : count(d)));
  const prev = before.map(count);
  const tomorrow = iso(addDays(new Date(), 1));
  const todayIso = iso(new Date());
  const dueTomorrow = homework.filter((h) => h.due_date === tomorrow).length;
  const dueToday = homework.filter((h) => h.due_date === todayIso).length;
  const set = sum(cur);
  const lastSet = sum(prev.slice(0, todayIdx + 1));
  return {
    stats: [
      { label: "Set this week", value: n(set), delta: change(set, lastSet, { suffix: "vs last week" }) },
      { label: "Due today", value: n(dueToday) },
      { label: "Due tomorrow", value: n(dueTomorrow) },
    ],
    chart: {
      cur,
      prev,
      labels: days.map((d) => d.toLocaleDateString("en-IN", { weekday: "short" })),
      titles: days.map(dayLabel),
      prevTitles: before.map(dayLabel),
      tickEvery: 1,
      nowIdx: todayIdx,
      curName: "This week",
      prevName: "Last week",
      fmt: (v) => `${v} homework`,
      axis: (v) => String(v),
    },
  };
}

// Clean axis top and a middle line: 0, half, top.
function niceTop(max) {
  if (max <= 0) return 1;
  const pow = 10 ** Math.floor(Math.log10(max));
  const step = [1, 2, 2.5, 5, 10].find((s) => s * pow * 2 >= max) * pow;
  return step * 2;
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

const bar = (x, y, w, h, r = 3) => {
  if (h <= 0.5) return "";
  const rr = Math.min(r, h, w / 2);
  return `M${x},${y + h} V${y + rr} Q${x},${y} ${x + rr},${y} H${x + w - rr} Q${x + w},${y} ${x + w},${y + rr} V${y + h} Z`;
};

// Paired columns: this period solid, the last one striped (so the two
// never rely on shade alone). Hover or focus a day for its numbers.
function TrendChart({ cur, prev, labels, titles, prevTitles, tickEvery, nowIdx, curName, prevName, fmt, axis, max: fixedMax }) {
  const [ref, W] = useWidth();
  const [hover, setHover] = useState(null);
  const H = 190;
  const pad = { t: 22, r: 4, b: 22, l: 46 };
  const top = fixedMax ?? niceTop(Math.max(0, ...cur.map((v) => v ?? 0), ...prev.map((v) => v ?? 0)));
  const inner = Math.max(0, W - pad.l - pad.r);
  const band = inner / cur.length;
  const bw = Math.max(2, Math.min(18, (band - 6) / 2));
  const y = (v) => pad.t + (H - pad.t - pad.b) * (1 - Math.min(v, top) / top);
  const base = y(0);
  const x0 = (i) => pad.l + band * i + band / 2;
  const id = useRef(`hp${Math.random().toString(36).slice(2, 8)}`).current;
  const tip = hover === null ? null : { left: Math.min(Math.max(x0(hover), 80), W - 80) };

  return (
    <div className="trend-chart" ref={ref} onMouseLeave={() => setHover(null)}>
      <div className="trend-legend" aria-hidden="true">
        <span>
          <i className="trend-key is-cur" />
          {curName}
        </span>
        <span>
          <i className="trend-key is-prev" />
          {prevName}
        </span>
      </div>
      {W > 0 && (
        <svg width={W} height={H} role="img" aria-label={`${curName} against ${prevName}`}>
          <defs>
            <pattern id={id} width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="5" height="5" className="trend-prev-bg" />
              <line x1="0" y1="0" x2="0" y2="5" className="trend-prev-line" />
            </pattern>
          </defs>
          {[0, 0.5, 1].map((t) => (
            <g key={t}>
              <line x1={pad.l} x2={W - pad.r} y1={y(top * t)} y2={y(top * t)} className={t ? "trend-grid" : "trend-base"} />
              <text x={pad.l - 8} y={y(top * t) + 4} className="trend-axis" textAnchor="end">
                {axis(top * t)}
              </text>
            </g>
          ))}
          {nowIdx >= 0 && nowIdx < cur.length && (
            <g>
              <line x1={x0(nowIdx)} x2={x0(nowIdx)} y1={pad.t - 4} y2={base} className="trend-now" />
              <text x={x0(nowIdx)} y={pad.t - 9} className="trend-now-label" textAnchor="middle">
                Today
              </text>
            </g>
          )}
          {cur.map((v, i) => {
            const cx = x0(i);
            const p = prev[i];
            return (
              <g key={i} className={hover === i ? "is-hover" : ""}>
                {hover === i && <rect x={cx - band / 2} y={pad.t} width={band} height={base - pad.t} className="trend-hover" rx="6" />}
                {p !== null && <path d={bar(cx - bw - 1, y(p), bw, base - y(p))} fill={`url(#${id})`} className="trend-prev" />}
                {v !== null && <path d={bar(cx + 1, y(v), bw, base - y(v))} className="trend-cur" />}
                {i % tickEvery === 0 || tickEvery === 1 ? (
                  <text x={cx} y={H - 6} className="trend-axis" textAnchor="middle">
                    {labels[i]}
                  </text>
                ) : null}
                <rect
                  x={cx - band / 2}
                  y={0}
                  width={band}
                  height={H}
                  fill="transparent"
                  onMouseEnter={() => setHover(i)}
                  onFocus={() => setHover(i)}
                  onBlur={() => setHover(null)}
                  tabIndex={0}
                  aria-label={`${titles[i]}: ${v === null ? "not yet" : fmt(v)}; ${prevTitles[i]}: ${p === null ? "none" : fmt(p)}`}
                />
              </g>
            );
          })}
        </svg>
      )}
      {tip && (
        <div className="trend-tip" style={{ left: tip.left }}>
          <span>
            <i className="trend-key is-cur" />
            {titles[hover]} <b>{cur[hover] === null ? "–" : fmt(cur[hover])}</b>
          </span>
          <span>
            <i className="trend-key is-prev" />
            {prevTitles[hover]} <b>{prev[hover] === null ? "–" : fmt(prev[hover])}</b>
          </span>
        </div>
      )}
    </div>
  );
}

export function TrendPanel({ trend }) {
  if (!trend) return null;
  if (trend.loading) return <div className="home-trend is-loading" aria-busy="true" />;
  return (
    <div className="home-trend">
      <dl className="trend-stats">
        {trend.stats.map((s) => (
          <div key={s.label}>
            <dt>{s.label}</dt>
            <dd>{s.value}</dd>
            {s.delta && (
              <span className={`trend-delta is-${s.delta.dir}`}>
                {s.delta.dir !== "flat" && <Icon name={s.delta.dir === "up" ? "arrowUp" : "arrowDown"} size={12} weight="bold" />}
                {s.delta.text}
                {s.delta.suffix && <em> {s.delta.suffix}</em>}
              </span>
            )}
          </div>
        ))}
      </dl>
      <TrendChart {...trend.chart} />
    </div>
  );
}
