import { useEffect, useRef, useState } from "react";
import { LogoMark } from "./Logo.jsx";
import Icon from "./Icon.jsx";
import "./landing.css";

// Public page at godview.in for anyone not signed in. Claims are limited to
// what Godview does today: no invented customers, numbers or certifications.
//
// Photos: drop files into frontend/public/landing/ with the names in PHOTOS;
// until then each slot shows a drawn illustration instead.

const PHOTOS = {
  hero: { src: "/landing/hero.jpg", alt: "Students learning together in a classroom", art: "classroom" },
  teacher: { src: "/landing/teacher.jpg", alt: "A teacher checking a class on a tablet", art: "tablet" },
  sessions: { src: "/landing/graduation.jpg", alt: "Students celebrating graduation", art: "cap" },
  office: { src: "/landing/office.jpg", alt: "The school office at work", art: "shield" },
  success: { src: "/landing/success.jpg", alt: "Students cheering together", art: "trophy" },
};

const ROTATING = ["student", "teacher", "fee", "result", "session"];

const MARQUEE = [
  "Photo tiles", "Instant search", "Grade filters", "Academic sessions", "Fee dues", "Exam results",
  "Teacher notes", "Owner · Admin · Teacher", "School join codes", "Excel import", "Data in India",
];

const BENEFITS = [
  ["search", "Every student, one tap away", "Photo tiles for the whole school. Search by name, parent, admission number or phone, and filter by grade in a second."],
  ["upload", "Bring your data in minutes", "Import the student export from your current ERP. Classes, parents, photos and admission details come across in one go."],
  ["check", "Session after session", "Each academic year keeps its own classes and sections. Promote with a new import and look back any time."],
  ["file", "Fees at a glance", "See total pending dues and which students owe what, broken down by month and fee head."],
  ["edit", "Notes and results", "Teachers record exam marks and notes for their own students. Totals and percentages are worked out for you."],
  ["camera", "Works on any device", "Phones, tablets and laptops, with nothing to install. Staff sign in with their Google account."],
];

const SPOTLIGHTS = [
  {
    photo: "teacher",
    kicker: "For teachers",
    title: "Your class, ready before the bell.",
    body: "Teachers see only the classes they teach (faces, names and roll numbers) and can add marks, notes and fresh photos in seconds. Parents’ phone numbers and addresses stay with the office.",
    points: ["Only assigned classes", "Marks with totals and percentages", "Notes that stay with the student"],
  },
  {
    photo: "sessions",
    kicker: "For the school year",
    title: "Every session remembered.",
    body: "Each academic year keeps its own classes and sections. When students move up, import the new list. Last year stays exactly as it was, one click away.",
    points: ["Session switcher", "Past years are view-only", "Leavers kept as history"],
  },
  {
    photo: "office",
    kicker: "For the owner",
    title: "You decide who sees what.",
    body: "Share one join code with your staff. Each person asks to join with their designation and classes; you approve them and choose their role. Admin exports wait for your approval.",
    points: ["Owner-approved staff", "Owner-approved exports", "Rules enforced by the database"],
  },
];

const ROLES = [
  ["Owner", "Approves staff, assigns classes, edits the school profile and approves exports."],
  ["Admin", "Manages students, imports, fees and employees. Exports need the owner’s approval."],
  ["Teacher", "Sees only their classes, without parents’ phone numbers or addresses. Adds photos, notes and results."],
];

const JOURNEY = [
  ["upload", "Import your students", "Upload the Excel export from your current system."],
  ["plus", "Invite your staff", "Share your join code; approve each request and pick their classes."],
  ["search", "Run your school", "Everyone sees exactly what their role allows."],
  ["check", "Celebrate results", "Marks, notes and every session’s story, all in one place."],
];

const TRUST = [
  "Data stored in India (Mumbai)",
  "Encrypted in transit and at rest",
  "Only the last 4 digits of Aadhaar are kept",
  "Each school’s data is walled off from every other",
];

const PREVIEW = [
  ["AS", "Aarav Sharma", "Grade 3", "#dbeafe"],
  ["IK", "Ishita Kaur", "Grade 3", "#fce7f3"],
  ["RV", "Rohan Verma", "Grade 4", "#dcfce7"],
  ["MJ", "Meera Joshi", "Grade 4", "#fef3c7"],
  ["KS", "Kabir Singh", "Grade 5", "#ede9fe"],
  ["AN", "Anaya Negi", "Grade 5", "#e0f2fe"],
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
    tablet: (
      <>
        <rect x="55" y="34" width="90" height="128" rx="12" {...common} />
        {[0, 1, 2].map((r) =>
          [0, 1].map((c) => <rect key={`${r}${c}`} x={68 + c * 34} y={50 + r * 34} width="28" height="26" rx="5" {...common} />)
        )}
      </>
    ),
    cap: (
      <>
        <path d="M100 48 30 78l70 30 70-30-70-30Z" {...common} />
        <path d="M62 92v28c0 10 76 10 76 0V92" {...common} />
        <path d="M170 78v40" {...common} />
        <circle cx="170" cy="124" r="5" {...common} />
        <path d="M40 150l12-8M150 40l8-10M28 50l10 4" {...common} />
      </>
    ),
    shield: (
      <>
        <path d="M100 30 46 50v40c0 34 24 58 54 70 30-12 54-36 54-70V50L100 30Z" {...common} />
        <path d="m76 98 16 16 34-34" {...common} />
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

export default function Landing({ onLogin, error, busy }) {
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
            <a href="#journey">How it works</a>
            <a href="#roles">Roles</a>
            <a href="#privacy">Privacy</a>
          </nav>
          <button className="btn btn-primary lp-login" onClick={onLogin} disabled={busy}>
            Log in
          </button>
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
                Students, sessions, fees, teachers and results in one beautiful place, with the right access for every
                role and your data kept in India.
              </p>
              <div className="lp-cta lp-enter" style={{ "--d": "240ms" }}>
                <button className="btn btn-primary lp-btn-lg lp-shine" onClick={onLogin} disabled={busy}>
                  Log in with Google
                  <Icon name="chevronDown" className="lp-arrow" />
                </button>
                <button className="btn btn-secondary lp-btn-lg" onClick={onLogin} disabled={busy}>
                  Join with a school code
                </button>
              </div>
              {error && <p className="field-error">{error}</p>}
              <p className="lp-note lp-enter" style={{ "--d": "320ms" }}>
                Staff: sign in with Google, then enter the join code from your school office.
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
                  {PREVIEW.map(([ini, name, grade, tint], i) => (
                    <div key={name} className="lp-tile" style={{ "--i": i }}>
                      <div className="lp-tile-photo" style={{ background: tint }}>
                        {ini}
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
                  <strong>Result saved</strong>
                  <span>Grade 5 · Maths 46 / 50</span>
                </div>
              </div>
              <div className="lp-toast lp-toast-2" aria-hidden="true">
                <span className="lp-toast-icon">
                  <Icon name="plus" size={14} />
                </span>
                <div>
                  <strong>Teacher approved</strong>
                  <span>Classes 3-A, 3-B assigned</span>
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
        <section className="lp-section lp-spotlights">
          <div className="lp-wrap">
            {SPOTLIGHTS.map((s, i) => (
              <div key={s.title} className={`lp-spot${i % 2 ? " is-flipped" : ""}`}>
                <div className="lp-spot-media" data-reveal>
                  <PhotoSlot name={s.photo} />
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
              <h2 className="lp-h2">From first import to proud results.</h2>
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
                <p className="lp-sub">Bring your students, staff and results together and see your school clearly.</p>
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
