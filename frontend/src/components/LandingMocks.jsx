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
