import { useEffect, useRef, useState } from "react";
import { LogoMark } from "./Logo.jsx";
import Icon from "./Icon.jsx";
import { BusMock, FeeMock, MapMock, ProfileMock } from "./LandingMocks.jsx";
import { parentLoginLive } from "../pwa/install.js";
import "./landing.css";

// Public page at godview.in for anyone not signed in. Claims are limited to
// what Godview does today: no invented customers, numbers or certifications.
//
// Photos: drop files into frontend/public/landing/ with the names in PHOTOS;
// until then each slot shows a drawn illustration instead.

const PHOTOS = {
  hero: { src: "/landing/hero.jpg", alt: "Students learning together in a classroom", art: "classroom" },
  success: { src: "/landing/success.jpg", alt: "Students cheering together", art: "trophy" },
};

const ROTATING = ["student", "fee", "village", "bus stop", "result"];

const MARQUEE = [
  "Photo tiles", "Instant search", "Fee structure", "Printed receipts", "Fee analytics", "Student map",
  "Bus routes", "Call and WhatsApp", "Academic sessions", "Exam results", "Excel import",
  "Owner · Admin · Teacher", "Data in India",
];

const BENEFITS = [
  ["search", "Every student, one tap away", "Photo tiles for the whole school. Search by name, parent, admission number or phone, and filter by grade in a second."],
  ["upload", "Bring your data in minutes", "Import the student export and the pending dues list from your current system. Classes, parents, photos and balances come across in one go."],
  ["file", "Fees that add up", "Pending dues by month, collection by grade and the families who owe the most, on one page for the owner."],
  ["check", "Session after session", "Each academic year keeps its own classes, sections and fees. Promote with a new import and look back any time."],
  ["edit", "Notes and results", "Teachers record exam marks and notes for their own students. Totals and percentages are worked out for you."],
  ["camera", "Works on any device", "Phones, tablets and laptops, with nothing to install. Staff sign in with their Google account."],
];

const SPOTLIGHTS = [
  {
    mock: FeeMock,
    kicker: "Fees",
    title: "Set your fees once. Dues follow.",
    body: "Add a fee, choose how often it falls due (monthly, bi-annually, one time or your own months) and fill in an amount for each grade, split by stream for 11th and 12th. One click creates every student’s dues.",
    points: ["Grades from Nursery to 12 ready to fill", "Record payments and print one-page receipts", "Bring last year’s pending dues across"],
  },
  {
    mock: MapMock,
    kicker: "Student map",
    title: "See where your students come from.",
    body: "Every student is placed by their village. Numbers show how many come from each place, coloured from a few to many, with rings at 5, 10 and 15 km around the school. Click a village to see exactly who lives there.",
    points: ["Villages merge into clusters as you zoom out", "Filter by bus or no bus", "Only owners and admins can see it"],
  },
  {
    mock: BusMock,
    kicker: "Transport",
    title: "Bus routes, stop by stop.",
    body: "Set up each route with its stops in order. When you add a student, choose their route and stop, and see how many children board at every stop.",
    points: ["Routes with ordered stops", "Students per stop and per route", "Picked right in the Add student steps"],
  },
  {
    mock: ProfileMock,
    kicker: "For the office",
    title: "Every family, one tap away.",
    body: "Open a student to see family, school and fee details on one card. Call or WhatsApp a parent straight from it, and record a payment without leaving.",
    points: ["Call and WhatsApp buttons", "Due now and paid this session", "Teachers see their classes, not phone numbers"],
  },
];

const ROLES = [
  ["Owner", "Sets the fee structure, approves staff, assigns classes, edits the school profile and approves exports."],
  ["Admin", "Manages students, fees and receipts, bus routes and the student map. Exports need the owner’s approval."],
  ["Teacher", "Sees only their classes, without parents’ phone numbers or addresses. Adds photos, notes and results."],
];

const JOURNEY = [
  ["upload", "Import your students", "Upload the Excel export from your current system."],
  ["file", "Set your fees", "Add each fee once; dues are created for every student."],
  ["plus", "Invite your staff", "Share your join code; approve each request and pick their classes."],
  ["check", "Run your school", "Fees, maps and results, with everyone seeing what their role allows."],
];

const NEXT = [
  ["message", "Parent app", "Parents see results, shared notes and dues, and send leave or certificate requests to the school."],
  ["bus", "Live bus tracking", "Parents and the school see where the bus is and when it will reach each stop."],
  ["phone", "WhatsApp sign-in", "Parents sign in with a one-time code sent on WhatsApp, with no password to remember."],
];

const TRUST = [
  "Data stored in India (Mumbai)",
  "Encrypted in transit and at rest",
  "Only the last 4 digits of Aadhaar are kept",
  "Home locations seen only by owners and admins",
  "Each school’s data is walled off from every other",
];

const PREVIEW = [
  ["AS", "Aarav Sharma", "Grade 3", "#dbeafe", "paid"],
  ["IK", "Ishita Kaur", "Grade 3", "#fce7f3", "due"],
  ["RV", "Rohan Verma", "Grade 4", "#dcfce7", "paid"],
  ["MJ", "Meera Joshi", "Grade 4", "#fef3c7", "paid"],
  ["KS", "Kabir Singh", "Grade 5", "#ede9fe", "overdue"],
  ["AN", "Anaya Negi", "Grade 5", "#e0f2fe", "paid"],
];

// ------------------------------------------------------------- motion ---

const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

// Adds .is-in to [data-reveal] elements as they scroll into view.
function useReveal(root) {
  useEffect(() => {
    const els = root.current?.querySelectorAll("[data-reveal]") ?? [];
    if (reducedMotion() || !("IntersectionObserver" in window)) {
      els.forEach((el) => el.classList.add("is-in"));
      return;
    }
    const io = new IntersectionObserver(
      (entries) =>
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add("is-in");
            io.unobserve(e.target);
          }
        }),
      { threshold: 0.18, rootMargin: "0px 0px -8% 0px" }
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [root]);
}

// Page scroll as a CSS variable (for parallax) and a "scrolled" flag for the nav.
function useScrollVars(root) {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    if (reducedMotion()) return;
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        root.current?.style.setProperty("--scroll", String(window.scrollY));
        setScrolled(window.scrollY > 12);
      });
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
    };
  }, [root]);
  return scrolled;
}

function RotatingWord() {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (reducedMotion()) return;
    const t = setInterval(() => setI((n) => (n + 1) % ROTATING.length), 2200);
    return () => clearInterval(t);
  }, []);
  return (
    <span className="lp-rotator" aria-live="off">
      <span key={i} className="lp-rotator-word">
        {ROTATING[i]}
      </span>
    </span>
  );
}

// ------------------------------------------------------------- photos ---

// Drawn stand-ins shown until a real photo is added.
function Art({ kind }) {
  const common = { fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" };
  const shapes = {
    classroom: (
      <>
        <rect x="38" y="30" width="124" height="70" rx="6" {...common} />
        <path d="M58 52h50M58 66h80M58 80h36" {...common} />
        <circle cx="60" cy="128" r="12" {...common} />
        <circle cx="100" cy="128" r="12" {...common} />
        <circle cx="140" cy="128" r="12" {...common} />
        <path d="M44 162c4-12 28-12 32 0M84 162c4-12 28-12 32 0M124 162c4-12 28-12 32 0" {...common} />
      </>
    ),
    trophy: (
      <>
        <path d="M70 40h60v30c0 22-14 36-30 36S70 92 70 70V40Z" {...common} />
        <path d="M70 52H52c0 20 10 30 22 30M130 52h18c0 20-10 30-22 30M100 106v24M78 154h44M86 130h28v24H86z" {...common} />
        <path d="m40 34 4 8 8 2-8 3-4 8-3-8-8-3 8-2 3-8ZM160 120l3 6 6 2-6 2-3 6-2-6-6-2 6-2 2-6Z" {...common} />
      </>
    ),
  };
  return (
    <svg className="lp-art" viewBox="0 0 200 190" aria-hidden="true">
      {shapes[kind]}
    </svg>
  );
}

function PhotoSlot({ name, className = "" }) {
  const { src, alt, art } = PHOTOS[name];
  const [state, setState] = useState("loading"); // loading | ok | missing
  return (
    <figure className={`lp-photo lp-photo-${name} ${className} is-${state}`}>
      {state !== "missing" && (
        <img src={src} alt={alt} loading="lazy" onLoad={() => setState("ok")} onError={() => setState("missing")} />
      )}
      {state !== "ok" && <Art kind={art} />}
    </figure>
  );
}

// --------------------------------------------------------------- page ---

export default function Landing({ onLogin, onParentLogin, error, busy }) {
  const root = useRef(null);
  const preview = useRef(null);
  useReveal(root);
  const scrolled = useScrollVars(root);

  // Preview leans toward the pointer.
  function tilt(e) {
    if (reducedMotion() || !preview.current) return;
    const r = preview.current.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - 0.5;
    const y = (e.clientY - r.top) / r.height - 0.5;
    preview.current.style.setProperty("--rx", `${(-y * 8).toFixed(2)}deg`);
    preview.current.style.setProperty("--ry", `${(x * 10).toFixed(2)}deg`);
  }
  const untilt = () => {
    preview.current?.style.setProperty("--rx", "0deg");
    preview.current?.style.setProperty("--ry", "0deg");
  };

  return (
    <div className="lp" ref={root}>
      <div className="lp-bg" aria-hidden="true">
        <span className="lp-blob lp-blob-1" />
        <span className="lp-blob lp-blob-2" />
        <span className="lp-blob lp-blob-3" />
        <span className="lp-gridlines" />
      </div>

      <header className={`lp-nav${scrolled ? " is-scrolled" : ""}`}>
        <div className="lp-wrap lp-nav-inner">
          <a className="logo" href="/" aria-label="Godview home">
            <LogoMark size={28} />
            <span className="logo-word">Godview</span>
          </a>
          <nav className="lp-links" aria-label="Page">
            <a href="#benefits">Why Godview</a>
            <a href="#features">Features</a>
            <a href="#journey">How it works</a>
            <a href="#privacy">Privacy</a>
          </nav>
          <div className="lp-nav-actions">
            {parentLoginLive && (
              <button className="btn btn-secondary lp-parent" onClick={onParentLogin}>
                Parent login
              </button>
            )}
            <button className="btn btn-primary lp-login" onClick={onLogin} disabled={busy}>
              Log in
            </button>
          </div>
        </div>
      </header>

      <main>
        {/* ------------------------------------------------------- hero */}
        <section className="lp-hero">
          <div className="lp-wrap lp-hero-inner">
            <div className="lp-hero-copy">
              <span className="lp-eyebrow lp-enter" style={{ "--d": "0ms" }}>
                <span className="lp-spark" /> School management for Indian schools
              </span>
              <h1 className="lp-enter" style={{ "--d": "80ms" }}>
                See every
                <br />
                <RotatingWord />
                <br />
                at a glance.
              </h1>
              <p className="lp-lead lp-enter" style={{ "--d": "160ms" }}>
                Students, fees, bus routes and results in one beautiful place, with a map of where your students come
                from, the right access for every role and your data kept in India.
              </p>
              <div className="lp-cta lp-enter" style={{ "--d": "240ms" }}>
                <button className="btn btn-primary lp-btn-lg lp-shine" onClick={onLogin} disabled={busy}>
                  Log in with Google
                  <Icon name="chevronDown" className="lp-arrow" />
                </button>
                {parentLoginLive ? (
                  <button className="btn btn-secondary lp-btn-lg" onClick={onParentLogin}>
                    <Icon name="phone" />
                    I’m a parent
                  </button>
                ) : (
                  <button className="btn btn-secondary lp-btn-lg" onClick={onLogin} disabled={busy}>
                    Join with a school code
                  </button>
                )}
              </div>
              {error && <p className="field-error">{error}</p>}
              <p className="lp-note lp-enter" style={{ "--d": "320ms" }}>
                Staff: sign in with Google, then enter the join code from your school office.
                {parentLoginLive && " Parents: log in with the mobile number the school has on record."}
              </p>
            </div>

            <div className="lp-hero-visual" onMouseMove={tilt} onMouseLeave={untilt}>
              <PhotoSlot name="hero" className="lp-hero-photo lp-enter" />
              <div className="lp-preview lp-enter" style={{ "--d": "200ms" }} ref={preview} aria-hidden="true">
                <div className="lp-preview-bar">
                  <span className="lp-dot" />
                  <span className="lp-dot" />
                  <span className="lp-dot" />
                </div>
                <div className="lp-preview-head">
                  <strong>642 students</strong>
                  <span className="lp-pill">Session 2026-27</span>
                </div>
                <div className="lp-preview-grid">
                  {PREVIEW.map(([ini, name, grade, tint, fee], i) => (
                    <div key={name} className="lp-tile" style={{ "--i": i }}>
                      <div className="lp-tile-photo" style={{ background: tint }}>
                        {ini}
                        <i className={`lp-tile-fee is-${fee}`} />
                      </div>
                      <div className="lp-tile-body">
                        <span className="lp-tile-tag">{grade}</span>
                        <span className="lp-tile-name">{name}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="lp-toast lp-toast-1" aria-hidden="true">
                <span className="lp-toast-icon lp-ok">
                  <Icon name="check" size={14} />
                </span>
                <div>
                  <strong>Payment recorded</strong>
                  <span>₹7,200 · Receipt printed</span>
                </div>
              </div>
              <div className="lp-toast lp-toast-2" aria-hidden="true">
                <span className="lp-toast-icon">
                  <Icon name="pin" size={14} />
                </span>
                <div>
                  <strong>Saha · 27 students</strong>
                  <span>19 travel by school bus</span>
                </div>
              </div>
              <span className="lp-float-cap" aria-hidden="true">🎓</span>
              <span className="lp-float-star" aria-hidden="true">⭐</span>
            </div>
          </div>
        </section>

        {/* ---------------------------------------------------- marquee */}
        <div className="lp-marquee" aria-label="What Godview covers">
          <div className="lp-marquee-track">
            {[...MARQUEE, ...MARQUEE].map((m, i) => (
              <span key={i} aria-hidden={i >= MARQUEE.length}>
                <i className="lp-marquee-dot" />
                {m}
              </span>
            ))}
          </div>
        </div>

        {/* --------------------------------------------------- benefits */}
        <section id="benefits" className="lp-section">
          <div className="lp-wrap">
            <div className="lp-head" data-reveal>
              <span className="lp-kicker">Why Godview</span>
              <h2 className="lp-h2">Everything your school runs on, beautifully simple.</h2>
            </div>
            <div className="lp-grid">
              {BENEFITS.map(([icon, title, body], i) => (
                <article
                  key={title}
                  className="lp-card"
                  data-reveal
                  style={{ "--d": `${i * 80}ms` }}
                  onMouseMove={(e) => {
                    const r = e.currentTarget.getBoundingClientRect();
                    e.currentTarget.style.setProperty("--mx", `${e.clientX - r.left}px`);
                    e.currentTarget.style.setProperty("--my", `${e.clientY - r.top}px`);
                  }}
                >
                  <span className="lp-icon">
                    <Icon name={icon} size={20} />
                  </span>
                  <h3>{title}</h3>
                  <p>{body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* ------------------------------------------------- spotlights */}
        <section id="features" className="lp-section lp-spotlights">
          <div className="lp-wrap">
            {SPOTLIGHTS.map((s, i) => (
              <div key={s.title} className={`lp-spot${i % 2 ? " is-flipped" : ""}`}>
                <div className="lp-spot-media" data-reveal>
                  <s.mock />
                </div>
                <div className="lp-spot-copy" data-reveal style={{ "--d": "120ms" }}>
                  <span className="lp-kicker">{s.kicker}</span>
                  <h2 className="lp-h2">{s.title}</h2>
                  <p className="lp-sub">{s.body}</p>
                  <ul className="lp-checks">
                    {s.points.map((p) => (
                      <li key={p}>
                        <Icon name="check" size={16} />
                        {p}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ---------------------------------------------------- journey */}
        <section id="journey" className="lp-section lp-journey-section">
          <div className="lp-wrap">
            <div className="lp-head" data-reveal>
              <span className="lp-kicker">How it works</span>
              <h2 className="lp-h2">From first import to a school that runs itself.</h2>
            </div>
            <div className="lp-journey" data-reveal>
              <svg className="lp-journey-path" viewBox="0 0 1000 120" preserveAspectRatio="none" aria-hidden="true">
                <path d="M10 100 C 180 100, 220 40, 340 60 S 560 110, 680 50 S 880 10, 990 20" />
              </svg>
              <ol>
                {JOURNEY.map(([icon, title, text], i) => (
                  <li key={title} style={{ "--d": `${300 + i * 260}ms` }}>
                    <span className={`lp-step${i === JOURNEY.length - 1 ? " lp-step-goal" : ""}`}>
                      {i === JOURNEY.length - 1 ? "🏆" : <Icon name={icon} size={18} />}
                    </span>
                    <h3>{title}</h3>
                    <p>{text}</p>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </section>

        {/* ------------------------------------------------------ roles */}
        <section id="roles" className="lp-section">
          <div className="lp-wrap">
            <div className="lp-head" data-reveal>
              <span className="lp-kicker">Roles</span>
              <h2 className="lp-h2">The right access for every person.</h2>
              <p className="lp-sub">Access rules are enforced by the database itself, not just hidden buttons.</p>
            </div>
            <div className="lp-roles">
              {ROLES.map(([role, text], i) => (
                <div key={role} className="lp-role" data-reveal style={{ "--d": `${i * 100}ms` }}>
                  <span className="tag">{role}</span>
                  <p>{text}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ------------------------------------------------------- next */}
        <section className="lp-section lp-next-section">
          <div className="lp-wrap">
            <div className="lp-head" data-reveal>
              <span className="lp-kicker">On the way</span>
              <h2 className="lp-h2">Bringing parents in next.</h2>
              <p className="lp-sub">What we’re building now, on top of the routes, fees and notes your school already keeps.</p>
            </div>
            <div className="lp-next">
              {NEXT.map(([icon, title, text], i) => (
                <article key={title} className="lp-next-card" data-reveal style={{ "--d": `${i * 100}ms` }}>
                  <span className="lp-next-icon">
                    <Icon name={icon} size={18} />
                  </span>
                  <span className="lp-soon">In development</span>
                  <h3>{title}</h3>
                  <p>{text}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* ---------------------------------------------------- privacy */}
        <section id="privacy" className="lp-section lp-privacy-section">
          <div className="lp-wrap lp-privacy">
            <div data-reveal>
              <span className="lp-kicker lp-kicker-light">Privacy</span>
              <h2 className="lp-h2">Built to protect children’s data.</h2>
              <p className="lp-sub">
                Student records belong to the school. Godview keeps them private, in India, and visible only to the
                people who need them.
              </p>
            </div>
            <ul className="lp-trust">
              {TRUST.map((t, i) => (
                <li key={t} data-reveal style={{ "--d": `${i * 90}ms` }}>
                  <span className="lp-trust-icon">
                    <Icon name="check" size={16} />
                  </span>
                  {t}
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* -------------------------------------------------------- CTA */}
        <section className="lp-section lp-final">
          <div className="lp-wrap">
            <div className="lp-final-card" data-reveal>
              <PhotoSlot name="success" className="lp-final-photo" />
              <div className="lp-confetti" aria-hidden="true">
                {Array.from({ length: 28 }, (_, i) => (
                  <i key={i} style={{ "--i": i, left: `${(i * 37 + 11) % 100}%` }} />
                ))}
              </div>
              <div className="lp-final-copy">
                <h2 className="lp-h2">Every school deserves to shine.</h2>
                <p className="lp-sub">Bring your students, fees, buses and results together and see your school clearly.</p>
                <button className="btn btn-primary lp-btn-lg lp-shine" onClick={onLogin} disabled={busy}>
                  Log in with Google
                </button>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="lp-footer">
        <div className="lp-wrap lp-footer-inner">
          <span className="logo">
            <LogoMark size={20} />
            <span className="logo-word">Godview</span>
          </span>
          <span>© {new Date().getFullYear()} Godview</span>
        </div>
      </footer>
    </div>
  );
}
