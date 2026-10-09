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

const STOPS = [
  ["Rampur Chowk", 14],
  ["Saha bus stand", 19],
  ["Kalpi gate", 9],
  ["Alipur", 6],
];

export function BusMock() {
  return (
    <div className="lpm lpm-bus">
      <div className="lpm-card">
        <div className="lpm-bus-head">
          <span className="lpm-bus-icon">
            <Icon name="bus" size={18} />
          </span>
          <div>
            <strong>Route 2 · Saha</strong>
            <span>4 stops · 48 students</span>
          </div>
        </div>
        <ol className="lpm-stops">
          {STOPS.map(([stop, n], i) => (
            <li key={stop} style={{ "--i": i }}>
              <span className="lpm-stop-no">{i + 1}</span>
              <span className="lpm-stop-name">{stop}</span>
              <span className="lpm-stop-n">{n} students</span>
            </li>
          ))}
          <li className="is-school">
            <span className="lpm-stop-no">
              <Icon name="pin" size={12} />
            </span>
            <span className="lpm-stop-name">School</span>
          </li>
        </ol>
      </div>
      <div className="lpm-float lpm-pick">
        <span className="lpm-float-icon">
          <Icon name="bus" size={14} />
        </span>
        <div>
          <strong>School bus</strong>
          <span>Route 2 · Saha bus stand</span>
        </div>
      </div>
    </div>
  );
}

export function ProfileMock() {
  return (
    <div className="lpm lpm-profile">
      <div className="lpm-card">
        <div className="lpm-band" />
        <div className="lpm-avatar">IK</div>
        <div className="lpm-profile-body">
          <strong className="lpm-name">Ishita Kaur</strong>
          <div className="lpm-chips">
            <span className="is-id">#2417</span>
            <span className="is-tag">Grade 5</span>
            <span>Section B</span>
          </div>
          <div className="lpm-feestrip">
            <div>
              <span>Due now</span>
              <strong className="is-due">{rupees(2400)}</strong>
            </div>
            <div>
              <span>Paid this session</span>
              <strong>{rupees(14400)}</strong>
            </div>
          </div>
          <div className="lpm-actions">
            <span className="lpm-btn">
              <Icon name="phone" size={14} /> Call
            </span>
            <span className="lpm-btn lpm-wa">
              <Icon name="message" size={14} /> WhatsApp
            </span>
          </div>
          <div className="lpm-tabs">
            <span className="is-on">Family</span>
            <span>Personal</span>
            <span>School</span>
          </div>
          <div className="lpm-rows">
            <span>Father</span>
            <strong>Harpreet Singh</strong>
            <span>Bus</span>
            <strong>Route 2 · Saha bus stand</strong>
          </div>
        </div>
      </div>
    </div>
  );
}
