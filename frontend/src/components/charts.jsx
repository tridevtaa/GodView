import { useState } from "react";
import { rupees } from "../data/money.js";

// Small single-series charts in plain SVG. One hue (the brand), thin marks
// with a 4px rounded data end, hairline grid, a hover tooltip on every mark,
// and a table view so no value depends on reading the chart.

const compact = (n) => {
  const v = Number(n) || 0;
  if (v >= 1e7) return `₹${(v / 1e7).toFixed(v >= 1e8 ? 0 : 1)} Cr`;
  if (v >= 1e5) return `₹${(v / 1e5).toFixed(v >= 1e6 ? 0 : 1)} L`;
  if (v >= 1e3) return `₹${Math.round(v / 1e3)}k`;
  return `₹${Math.round(v)}`;
};

// Clean axis maximum and ticks (0, 1/4, 1/2, 3/4, max).
function niceMax(max) {
  if (max <= 0) return 1;
  const pow = 10 ** Math.floor(Math.log10(max));
  const steps = [1, 2, 2.5, 5, 10];
  const unit = steps.find((s) => s * pow * 4 >= max) * pow;
  return unit * 4;
}

// Path for a bar with 4px rounded corners on its data end only.
function columnPath(x, y, w, h, r = 4) {
  if (h <= 0) return "";
  const rr = Math.min(r, h, w / 2);
  return `M${x},${y + h} V${y + rr} Q${x},${y} ${x + rr},${y} H${x + w - rr} Q${x + w},${y} ${x + w},${y + rr} V${y + h} Z`;
}
function barPath(x, y, w, h, r = 4) {
  if (w <= 0) return "";
  const rr = Math.min(r, w, h / 2);
  return `M${x},${y} H${x + w - rr} Q${x + w},${y} ${x + w},${y + rr} V${y + h - rr} Q${x + w},${y + h} ${x + w - rr},${y + h} H${x} Z`;
}

function TableToggle({ showTable, setShowTable }) {
  return (
    <button className="link-btn chart-toggle" onClick={() => setShowTable((v) => !v)}>
      {showTable ? "Show chart" : "Show table"}
    </button>
  );
}

// Columns over time. data: [{ key, label, value, note }]
export function ColumnChart({ title, subtitle, data, valueLabel = "Collected" }) {
  const [hover, setHover] = useState(null);
  const [showTable, setShowTable] = useState(false);
  const W = 640;
  const H = 220;
  const pad = { t: 12, r: 8, b: 26, l: 52 };
  const max = niceMax(Math.max(0, ...data.map((d) => d.value)));
  const band = (W - pad.l - pad.r) / data.length;
  const bw = Math.min(24, band * 0.55);
  const y = (v) => pad.t + (H - pad.t - pad.b) * (1 - v / max);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => t * max);
  const top = data.reduce((best, d) => (d.value > (best?.value ?? 0) ? d : best), null);

  return (
    <figure className="chart">
      <figcaption>
        <div>
          <h3>{title}</h3>
          {subtitle && <p className="row-sub">{subtitle}</p>}
        </div>
        <TableToggle showTable={showTable} setShowTable={setShowTable} />
      </figcaption>
      {showTable ? (
        <table className="chart-table">
          <thead>
            <tr>
              <th>Month</th>
              <th className="num">{valueLabel}</th>
            </tr>
          </thead>
          <tbody>
            {data.map((d) => (
              <tr key={d.key}>
                <td>{d.label}</td>
                <td className="num">{rupees(d.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="chart-plot" onMouseLeave={() => setHover(null)}>
          <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${title}. Highest: ${top ? `${top.label}, ${rupees(top.value)}` : "none"}.`}>
            {ticks.map((t) => (
              <g key={t}>
                <line className="chart-grid" x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} />
                <text className="chart-axis" x={pad.l - 8} y={y(t) + 4} textAnchor="end">
                  {compact(t)}
                </text>
              </g>
            ))}
            {data.map((d, i) => {
              const cx = pad.l + band * i + band / 2;
              const yy = y(d.value);
              return (
                <g key={d.key} onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} tabIndex={0}>
                  <rect className="chart-hit" x={cx - band / 2} y={pad.t} width={band} height={H - pad.t - pad.b} />
                  <path className={`chart-mark${hover === i ? " is-hover" : ""}`} d={columnPath(cx - bw / 2, yy, bw, H - pad.b - yy)} />
                  <text className="chart-axis" x={cx} y={H - 8} textAnchor="middle">
                    {d.short ?? d.label}
                  </text>
                </g>
              );
            })}
          </svg>
          {hover !== null && (
            <div
              className="chart-tip"
              style={{ left: `${((pad.l + band * hover + band / 2) / W) * 100}%`, top: `${(y(data[hover].value) / H) * 100}%` }}
            >
              <strong>{data[hover].label}</strong>
              <span>
                {valueLabel}: {rupees(data[hover].value)}
              </span>
              {data[hover].note && <span>{data[hover].note}</span>}
            </div>
          )}
        </div>
      )}
    </figure>
  );
}

// Horizontal bars by category. data: [{ key, label, value, note }]
export function BarChart({ title, subtitle, data, valueLabel }) {
  const [hover, setHover] = useState(null);
  const [showTable, setShowTable] = useState(false);
  const row = 30;
  const W = 640;
  const labelW = 110;
  const valueW = 90;
  const H = data.length * row + 8;
  const max = Math.max(1, ...data.map((d) => d.value));
  const bw = (v) => ((W - labelW - valueW - 12) * v) / max;

  return (
    <figure className="chart">
      <figcaption>
        <div>
          <h3>{title}</h3>
          {subtitle && <p className="row-sub">{subtitle}</p>}
        </div>
        <TableToggle showTable={showTable} setShowTable={setShowTable} />
      </figcaption>
      {showTable ? (
        <table className="chart-table">
          <thead>
            <tr>
              <th>Class</th>
              <th className="num">{valueLabel}</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            {data.map((d) => (
              <tr key={d.key}>
                <td>{d.label}</td>
                <td className="num">{rupees(d.value)}</td>
                <td className="row-sub">{d.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="chart-plot" onMouseLeave={() => setHover(null)}>
          <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${title}, ${data.length} classes.`}>
            <line className="chart-grid" x1={labelW} x2={labelW} y1={0} y2={H} />
            {data.map((d, i) => {
              const yy = i * row + 6;
              const h = 16;
              return (
                <g key={d.key} onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} tabIndex={0}>
                  <rect className="chart-hit" x={0} y={i * row} width={W} height={row} />
                  <text className="chart-label" x={labelW - 10} y={yy + 12} textAnchor="end">
                    {d.label}
                  </text>
                  <path className={`chart-mark${hover === i ? " is-hover" : ""}`} d={barPath(labelW, yy, Math.max(bw(d.value), d.value > 0 ? 3 : 0), h)} />
                  <text className="chart-value" x={labelW + bw(d.value) + 8} y={yy + 12}>
                    {d.value > 0 ? compact(d.value) : "₹0"}
                  </text>
                </g>
              );
            })}
          </svg>
          {hover !== null && (
            <div className="chart-tip chart-tip-side" style={{ top: `${((hover * row + 6) / H) * 100}%`, left: `${((labelW + bw(data[hover].value)) / W) * 100}%` }}>
              <strong>{data[hover].label}</strong>
              <span>
                {valueLabel}: {rupees(data[hover].value)}
              </span>
              {data[hover].note && <span>{data[hover].note}</span>}
            </div>
          )}
        </div>
      )}
    </figure>
  );
}
