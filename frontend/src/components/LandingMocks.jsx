import { useEffect, useState } from "react";
import Icon from "./Icon.jsx";

// Drawn product previews for the landing page. Names, villages and amounts
// are made up; nothing here comes from a real school.

const rupees = (n) => "₹" + n.toLocaleString("en-IN");

const FEES = [
  ["Nursery", 2000],
  ["KG 1 to KG 2", 2100],
  ["Grade 1 to 5", 2400],
  ["Grade 6 to 8", 2600],
  ["Grade 9 to 10", 2800],
];

export function FeeMock() {
  return (
    <div className="lpm lpm-fee">
      <div className="lpm-card">
        <div className="lpm-fee-head">
          <strong>Monthly fee</strong>
          <span className="lpm-pill">
            Monthly <Icon name="chevronDown" size={13} />
          </span>
        </div>
        <div className="lpm-fee-cols">
          <span>Grade</span>
          <span>Per month</span>
          <span>Per year</span>
        </div>
        {FEES.map(([grade, amount], i) => (
          <div key={grade} className="lpm-fee-row" style={{ "--i": i }}>
            <span>{grade}</span>
            <span className="lpm-amount">{rupees(amount)}</span>
            <span className="lpm-year">{rupees(amount * 12)}</span>
          </div>
        ))}
        <div className="lpm-fee-row lpm-stream">
          <span>
            Grade 11 <em>Non Medical</em>
          </span>
          <span className="lpm-amount">{rupees(3100)}</span>
          <span className="lpm-year">{rupees(37200)}</span>
        </div>
        <div className="lpm-fee-total">
          <span>
            Whole school <strong>₹1.84 Cr / y</strong>
            <small>(avg ₹29,400 / student / y)</small>
          </span>
          <span className="lpm-btn">Create dues</span>
        </div>
      </div>
      <div className="lpm-float lpm-receipt">
        <span className="lpm-float-icon lpm-ok">
          <Icon name="check" size={14} />
        </span>
        <div>
          <strong>Payment recorded</strong>
          <span>{rupees(7200)} by UPI · Receipt ready to print</span>
        </div>
      </div>
    </div>
  );
}

// Village bubbles: [name, students, x%, y%]. Colour follows the count.
const VILLAGES = [
  ["Rampur", 64, 50, 48],
  ["Saha", 27, 38, 27],
  ["Kalpi", 18, 66, 33],
  ["Alipur", 12, 64, 62],
  ["Bihta", 7, 33, 66],
  ["Khera", 6, 78, 50],
  ["Dheen", 3, 20, 42],
  ["Sohana", 2, 86, 20],
  ["Tandwal", 4, 10, 62],
];
const tier = (n) => (n >= 50 ? 5 : n >= 20 ? 4 : n >= 10 ? 3 : n >= 5 ? 2 : 1);

export function MapMock() {
  return (
    <div className="lpm lpm-map">
      <div className="lpm-map-canvas">
        <svg className="lpm-roads" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          <path d="M-5 70 C 20 60, 35 52, 52 48 S 85 30, 105 22" />
          <path d="M30 -5 C 38 20, 46 36, 52 48 S 60 80, 58 105" />
          <path d="M-5 30 C 20 34, 40 40, 52 48" className="is-minor" />
          <path d="M52 48 C 66 56, 80 60, 105 64" className="is-minor" />
          <path d="M10 105 C 20 80, 24 70, 28 66" className="is-minor" />
          <path d="M70 -5 C 70 14, 70 24, 70 31" className="is-river" />
        </svg>
        {[15, 10, 5].map((km) => (
          <span key={km} className={`lpm-ring lpm-ring-${km}`}>
            <span className="lpm-ring-label">
              <strong>{km} km</strong> {km === 5 ? 91 : km === 10 ? 143 : 161}
            </span>
          </span>
        ))}
        {VILLAGES.map(([name, n, x, y], i) => (
          <span
            key={name}
            className={`lpm-bubble lpm-tier-${tier(n)}`}
            style={{ left: `${x}%`, top: `${y}%`, "--s": `${28 + Math.min(22, Math.sqrt(n) * 2.6)}px`, "--i": i }}
            title={name}
          >
            {n}
          </span>
        ))}
        <span className="lpm-school" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 10 12 5 2 10l10 5 10-5z" />
            <path d="M6 12v5c3 3 9 3 12 0v-5" />
          </svg>
        </span>
        <div className="lpm-legend">
          <span>Students</span>
          {["1–4", "5–9", "10–19", "20–49", "50+"].map((l, i) => (
            <span key={l} className="lpm-step">
              <i className={`lpm-tier-${i + 1}`} />
              {l}
            </span>
          ))}
        </div>
      </div>
      <div className="lpm-float lpm-village">
        <strong>Saha</strong>
        <span>27 students · 19 by bus</span>
        <div className="lpm-chips">
          <span>Grade 2 · 6</span>
          <span>Grade 5 · 4</span>
          <span>KG 1 · 3</span>
        </div>
      </div>
    </div>
  );
}

// Register: [initials, name, mark, tint]. P, A or L as in the app.
const REGISTER = [
  ["AS", "Aarav Sharma", "P", "#dbeafe"],
  ["IK", "Ishita Kaur", "P", "#fce7f3"],
  ["KS", "Kabir Singh", "A", "#ede9fe"],
  ["MJ", "Meera Joshi", "P", "#fef3c7"],
  ["RV", "Rohan Verma", "L", "#dcfce7"],
];

export function AttendanceMock() {
  return (
    <div className="lpm lpm-att">
      <div className="lpm-card">
        <div className="lpm-att-head">
          <div>
            <strong>Grade 3 · A</strong>
            <span>Monday, 19 Oct</span>
          </div>
          <span className="lpm-pill">38 of 40 present</span>
        </div>
        <ol className="lpm-register">
          {REGISTER.map(([ini, name, mark, tint], i) => (
            <li key={name} style={{ "--i": i }}>
              <span className="lpm-ini" style={{ background: tint }}>
                {ini}
              </span>
              <span className="lpm-reg-name">{name}</span>
              <span className="lpm-marks">
                {["P", "A", "L"].map((m) => (
                  <i key={m} className={m === mark ? `is-on is-${m}` : ""}>
                    {m}
                  </i>
                ))}
              </span>
            </li>
          ))}
        </ol>
        <div className="lpm-att-foot">
          <span className="lpm-btn">Save attendance</span>
        </div>
      </div>
      <div className="lpm-float lpm-absent">
        <span className="lpm-float-icon">
          <Icon name="bell" size={14} />
        </span>
        <div>
          <strong>Kabir is absent today</strong>
          <span>Sent to the parents at 11:00</span>
        </div>
      </div>
    </div>
  );
}

const PARENT_TILES = [
  ["rupee", "Fees", "All paid", "t-green"],
  ["chart", "Results", "Term 1 · 86%", "t-violet"],
  ["book", "Homework", "2 for tomorrow", "t-amber"],
  ["exam", "Datesheet", "Maths, 3 Nov", "t-pink"],
];

export function ParentMock() {
  return (
    <div className="lpm lpm-parent">
      <div className="lpm-phone">
        <div className="lpm-phone-head">
          <span className="lpm-ini" style={{ background: "#fce7f3" }}>
            IK
          </span>
          <div>
            <strong>Ishita</strong>
            <span>Grade 5 · B</span>
          </div>
          <span className="lpm-today">Present today</span>
        </div>
        <div className="lpm-ptiles">
          {PARENT_TILES.map(([icon, label, value, tone], i) => (
            <div key={label} className={`lpm-ptile ${tone}`} style={{ "--i": i }}>
              <Icon name={icon} size={16} />
              <span>{label}</span>
              <strong>{value}</strong>
            </div>
          ))}
        </div>
        <div className="lpm-chat">
          <span className="lpm-bubble-in">Ishita did well in the science quiz today!</span>
          <span className="lpm-bubble-out">Thank you, ma’am 🙏</span>
        </div>
        <div className="lpm-ptabs" aria-hidden="true">
          {["home", "rupee", "chart", "book", "plane"].map((n, i) => (
            <Icon key={n} name={n} size={18} className={i === 0 ? "is-on" : ""} />
          ))}
        </div>
      </div>
      <div className="lpm-float lpm-notice">
        <span className="lpm-float-icon">
          <Icon name="notice" size={14} />
        </span>
        <div>
          <strong>Annual day on 14 Nov</strong>
          <span>New notice from school</span>
        </div>
      </div>
    </div>
  );
}

// A made-up school's crest for the letterhead mock-ups.
function Crest() {
  return (
    <span className="lpm-crest" aria-hidden="true">
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M22 10 12 5 2 10l10 5 10-5z" />
        <path d="M6 12v5c3 3 9 3 12 0v-5" />
      </svg>
    </span>
  );
}

function Letterhead() {
  return (
    <div className="lpm-lhead">
      <Crest />
      <strong>Fox High School</strong>
      <span>Station Road, Kurukshetra, Haryana</span>
    </div>
  );
}

// Stages as in the app: [stage, count, applicants as name, class, note].
const PIPELINE = [
  ["Enquiry", 24, [["Riya Malik", "Nursery", "Visit on Sat"], ["Ayan Rao", "Grade 1", "Call back"]]],
  ["Registered", 9, [["Sana Gill", "KG 1", "Test 12 Nov"]]],
  ["Admitted", 31, [["Dev Saini", "Grade 2", "Starts 1 Apr"]]],
];

export function AdmissionsMock() {
  return (
    <div className="lpm lpm-adm">
      <div className="lpm-card">
        <div className="lpm-adm-head">
          <strong>Admissions</strong>
          <span className="lpm-pill">Session 2027-28</span>
        </div>
        <div className="lpm-stages">
          {PIPELINE.map(([stage, count, people], s) => (
            <div key={stage} className={`lpm-stage lpm-stage-${s}`}>
              <div className="lpm-stage-head">
                <span>{stage}</span>
                <b>{count}</b>
              </div>
              {people.map(([name, grade, note], i) => (
                <div key={name} className="lpm-app" style={{ "--i": s * 2 + i }}>
                  <strong>{name}</strong>
                  <span>{grade}</span>
                  <em>{note}</em>
                </div>
              ))}
            </div>
          ))}
        </div>
        <div className="lpm-seats">
          <span>Grade 1 seats</span>
          <span className="lpm-meter">
            <i style={{ "--w": "92%" }} />
          </span>
          <b>37 of 40</b>
        </div>
      </div>
      <div className="lpm-float lpm-adm-float">
        <span className="lpm-float-icon lpm-ok">
          <Icon name="check" size={14} />
        </span>
        <div>
          <strong>Sana is registered</strong>
          <span>REG-000041 · {rupees(1500)} receipt printed</span>
        </div>
      </div>
    </div>
  );
}

const CERT_KINDS = ["Bona fide", "Leaving (SLC)", "No dues", "Character", "Fee paid", "Date of birth"];

export function CertificateMock() {
  return (
    <div className="lpm lpm-cert">
      <div className="lpm-paper">
        <Letterhead />
        <div className="lpm-cert-meta">
          <span>No. BF-000124</span>
          <span>2 November 2026</span>
        </div>
        <strong className="lpm-paper-title">Bona fide certificate</strong>
        <p className="lpm-cert-text">
          This is to certify that <b>Aarav Sharma</b>, son of Mr. Rakesh Sharma, is a bona fide student of{" "}
          <b>Grade 3 A</b> in the session 2026-27. His date of birth as per our records is <b>14 March 2018</b>.
        </p>
        <div className="lpm-sign">
          <span>Principal</span>
        </div>
      </div>
      <div className="lpm-chips lpm-cert-kinds">
        {CERT_KINDS.map((k, i) => (
          <span key={k} className={i === 0 ? "is-on" : ""} style={{ "--i": i }}>
            {k}
          </span>
        ))}
      </div>
    </div>
  );
}

export function LetterMock() {
  return (
    <div className="lpm lpm-letter">
      <div className="lpm-paper">
        <Letterhead />
        <strong className="lpm-paper-title">Winter school timings</strong>
        <span className="lpm-letter-date">Date: 6 November 2026</span>
        <p>Dear Parents,</p>
        <p>From Monday, 16 November:</p>
        <ul>
          {["Classes I to V: 8:30 AM to 1:30 PM", "Classes VI to XII: 8:30 AM to 2:30 PM", "Buses leave 30 minutes later"].map(
            (t, i) => (
              <li key={t} style={{ "--i": i }}>
                {t}
              </li>
            )
          )}
        </ul>
        <div className="lpm-sign">
          <span>Mrs. Anita Rao, Principal</span>
        </div>
      </div>
      <div className="lpm-float lpm-letter-float">
        <span className="lpm-float-icon">
          <Icon name="notice" size={14} />
        </span>
        <div>
          <strong>On the noticeboard</strong>
          <span>Sent to parents and staff</span>
        </div>
      </div>
    </div>
  );
}

export function GoddessMock() {
  return (
    <div className="lpm lpm-goddess">
      <div className="lpm-g-panel">
        <div className="lpm-g-head">
          <img src="/concierge/face.jpg" alt="" loading="lazy" />
          <div>
            <strong>Goddess</strong>
            <span>Your school assistant</span>
          </div>
          <span className="lpm-g-tag">Premium</span>
        </div>
        <span className="lpm-g-ask">How much fee is pending in Grade 5?</span>
        <div className="lpm-g-reply">
          <p>
            <b>{rupees(142800)}</b> is pending from 23 students in Grade 5. Six of them are more than two months behind.
          </p>
          <div className="lpm-g-card">
            <span>Grade 5 fees collected</span>
            <span className="lpm-meter">
              <i style={{ "--w": "78%" }} />
            </span>
            <b>78%</b>
          </div>
        </div>
        <div className="lpm-g-input">
          <span>Ask Goddess anything</span>
          <Icon name="mic" size={16} />
        </div>
      </div>
    </div>
  );
}

// Counts up to a rupee amount once, shortly after the page opens.
function CountUp({ to, delay = 900, ms = 1600 }) {
  const still = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const [n, setN] = useState(still ? to : 0);
  useEffect(() => {
    if (still) return;
    let frame = 0;
    const start = performance.now() + delay;
    const tick = (now) => {
      const t = Math.min(1, Math.max(0, (now - start) / ms));
      setN(Math.round(to * (1 - Math.pow(1 - t, 3))));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [to, delay, ms, still]);
  return rupees(n);
}

const HOME_TABS = ["Home", "Students", "Fees", "Academics", "Planner", "Staff", "Transport"];
const HOME_QUICK = [
  ["scholar", "Add student", "#eef0ff", "#5b68c4"],
  ["newAdmission", "New enquiry", "#e0f2fe", "#0369a1"],
  ["rupee", "Collect fee", "#fef3c7", "#b45309"],
  ["notice", "Post notice", "#ffedd5", "#c2410c"],
  ["users", "Message parents", "#ede9fe", "#6d28d9"],
  ["calendar", "Add to calendar", "#f3e8ff", "#7e22ce"],
];
const HOME_TILES = [
  ["pink", "96%", "Present today", "612 of 638 students"],
  ["blue", "24", "Enquiries", "5 to call back today"],
  ["amber", "2", "Notices", "Winter school timings"],
  ["violet", "28 Nov", "Annual day", "In 19 days"],
];

// The staff Home screen, drawn at 1120px wide and scaled by the page.
export function HomeMock() {
  return (
    <div className="lph">
      <div className="lph-bar">
        <strong className="lph-school">Fox High School</strong>
        <span className="lph-session">
          26-27 <Icon name="chevronDown" size={12} />
        </span>
        <nav className="lph-tabs">
          {HOME_TABS.map((t, i) => (
            <span key={t} className={i === 0 ? "is-on" : ""}>
              {t}
            </span>
          ))}
        </nav>
        <span className="lph-icons">
          <Icon name="search" size={18} />
          <span className="lph-send">
            <Icon name="send" size={18} />
            <i>3</i>
          </span>
          <span className="lph-avatar">A</span>
        </span>
      </div>
      <div className="lph-body">
        <span className="lph-date">Monday, 9 November</span>
        <strong className="lph-hello">Good morning, Asha</strong>
        <div className="lph-card">
          <svg className="lph-chart" viewBox="0 0 460 190" aria-hidden="true">
            <text x="0" y="24">₹10 L</text>
            <text x="8" y="92">₹5 L</text>
            <path className="lph-grid" d="M44 20H430M44 88H430" />
            <path className="lph-axis" d="M44 156H430" />
            <path className="lph-last" d="M48 154 C 140 140, 240 104, 420 34" />
            <text className="lph-tag" x="428" y="38">Oct</text>
            <path className="lph-area" d="M48 154 C 80 140, 110 126, 150 112 L150 156 L48 156 Z" />
            <path className="lph-now" d="M48 154 C 80 140, 110 126, 150 112" />
            <circle className="lph-pt" cx="150" cy="112" r="5" />
            <text className="lph-tag lph-tag-now" x="162" y="108">Nov so far</text>
            <text x="44" y="182">1 Nov</text>
            <text x="214" y="182">15 Nov</text>
            <text x="388" y="182">30 Nov</text>
          </svg>
          <div className="lph-figs">
            <div>
              <span>Fees pending</span>
              <strong>₹4.8 L</strong>
              <em className="lph-red">12 students overdue</em>
            </div>
            <div>
              <span>Collected this month</span>
              <strong>
                <CountUp to={642000} />
              </strong>
              <em className="lph-green">↑ {rupees(120500)} more than this time last month</em>
            </div>
            <span className="lph-view">
              View fees <Icon name="arrowRight" size={14} />
            </span>
          </div>
        </div>
        <div className="lph-quick">
          {HOME_QUICK.map(([icon, label, bg, fg], i) => (
            <span key={label} style={{ "--i": i }}>
              <i style={{ background: bg, color: fg }}>
                <Icon name={icon} size={15} />
              </i>
              {label}
            </span>
          ))}
        </div>
        <div className="lph-tiles">
          {HOME_TILES.map(([tone, big, label, note], i) => (
            <div key={label} className={`lph-tile lph-${tone}`} style={{ "--i": i }}>
              <strong>{big}</strong>
              <span>{label}</span>
              <em>{note}</em>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
