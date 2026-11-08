import { useEffect, useRef, useState } from "react";
import { LogoMark } from "./Logo.jsx";
import Icon from "./Icon.jsx";
import {
  AdmissionsMock,
  AttendanceMock,
  CertificateMock,
  FeeMock,
  GoddessMock,
  HomeMock,
  LetterMock,
  MapMock,
  ParentMock,
} from "./LandingMocks.jsx";
import { parentLoginLive } from "../pwa/install.js";
import "./landing.css";

// Public page at godview.in for anyone not signed in. Claims are limited to
// what Godview does today: no invented customers, numbers or certifications.
// Every picture is a drawn product preview (LandingMocks.jsx), not a photo.

const ROTATING = ["student", "admission", "absence", "fee", "homework", "village", "result"];

const MARQUEE = [
  "Admissions", "Certificates", "Letterhead notices", "Attendance", "Parent app", "Homework",
  "Datesheet and syllabus", "Timetable", "Calendar", "Noticeboard", "Fee structure", "Printed receipts",
  "Fee reports", "Bulk messages", "Student map", "Buses and routes", "Exam results", "Student documents",
  "Excel import", "Goddess AI assistant", "Owner · Admin · Principal · Teacher", "Data in India",
];

// What's new: pinned on computers, the picture changing as each one scrolls past.
const NEW = [
  {
    mock: AdmissionsMock,
    kicker: "Admissions",
    title: "From first enquiry to first day.",
    body: "Note every enquiry, register with a fee and a printed receipt, then admit in one step. Their details and documents carry over, so nothing is typed twice.",
    points: ["An optional test or interview step", "Seats per class, with a warning when full", "Registration fee kept apart or counted towards fees"],
  },
  {
    mock: CertificateMock,
    kicker: "Certificates",
    title: "Certificates in a few clicks.",
    body: "Bona fide, leaving (SLC), no dues, character, fee paid and date of birth, filled in from the student’s record and printed on your letterhead.",
    points: ["Serial numbers kept in a register", "No dues refused while fees are due", "A second SLC is marked duplicate"],
  },
  {
    mock: LetterMock,
    kicker: "Letters",
    title: "Notices on your letterhead.",
    body: "Write a notice and Godview sets it as a letter with your school’s name and logo, a greeting and a signature. Families see the letter itself, next to news and achievements.",
    points: ["For parents, staff or both", "Ready to print", "Owners and admins only"],
  },
  {
    mock: GoddessMock,
    kicker: "Goddess · Premium",
    title: "Ask your school anything.",
    body: "An AI assistant for owners, admins and principals. Type or speak a question and she answers from your school’s own data.",
    points: ["Answers by voice or text", "Fees and attendance cards on request", "Insights on fees, transport and results"],
  },
];

const BENEFITS = [
  ["search", "Every student, one tap away", "Photo tiles for the whole school. Search by name, parent or phone, then call or WhatsApp a family straight from the profile."],
  ["upload", "Bring your data in minutes", "Import the student export and the pending dues list from your current system. Classes, parents, photos and balances come across in one go."],
  ["book", "Homework and syllabus", "Teachers set homework for a class or a few students, and keep the syllabus covered for each subject. Parents see both."],
  ["exam", "Exams and results", "Set the datesheet for each class, then enter marks or upload a sheet. Totals and percentages are worked out for you."],
  ["calendar", "Calendar and notices", "Holidays, exams, events and meetings on one calendar, and a noticeboard with pictures for news and achievements."],
  ["bell", "On every phone", "Add Godview to the home screen like an app. Notifications bring messages, absences, homework and fee reminders."],
];

const SPOTLIGHTS = [
  {
    mock: AttendanceMock,
    kicker: "Attendance",
    title: "The register, done in a minute.",
    body: "The class teacher marks Present, Absent or Leave from their phone each morning. The office sees which classes are still unmarked, and parents of absent children hear about it the same morning.",
    points: ["All present in one tap, then change the few", "Reminders for classes still unmarked", "Parents see the month at a glance"],
  },
  {
    mock: ParentMock,
    kicker: "Parent app",
    title: "Parents in the loop, without the calls.",
    body: "Parents log in with the mobile number the school has on record. Each child has their own home with attendance, fees, results, homework, the datesheet and a chat with the class teacher.",
    points: ["One conversation per child with the school", "Notices and the school calendar", "Nothing new for parents to download"],
  },
  {
    mock: FeeMock,
    kicker: "Fees",
    title: "Set your fees once. Dues follow.",
    body: "Add a fee, choose how often it falls due (monthly, bi-annually, one time or your own months) and fill in an amount for each grade, split by stream for 11th and 12th. One click creates every student’s dues.",
    points: ["Collected today and the last 7 days at a glance", "Print one-page receipts", "Reminders to parents before and after the due date"],
  },
  {
    mock: MapMock,
    kicker: "Student map and transport",
    title: "See where your students come from.",
    body: "Every student is placed by their village, with rings at 5, 10 and 15 km around the school. Set up bus routes with their stops in order and see how many children board at each one.",
    points: ["Click a village to see exactly who lives there", "Buses with their drivers and papers", "Only owners and admins can see it"],
  },
];

const ROLES = [
  ["Owner", "Sets the fee structure, approves staff, assigns classes, edits the school profile and approves exports."],
  ["Admin", "Runs the office: admissions, students, fees and receipts, certificates, bus routes and the calendar."],
  ["Principal", "Sees the whole school, from attendance to results, and answers parents’ messages. Looks, never edits."],
  ["Teacher", "Sees only their classes, without parents’ phone numbers. Takes attendance, sets homework and marks, and messages parents."],
];

const JOURNEY = [
  ["upload", "Import your students", "Upload the Excel export from your current system."],
  ["file", "Set your fees", "Add each fee once; dues are created for every student."],
  ["plus", "Invite your staff", "Share your join code; approve each request and pick their classes."],
  ["check", "Bring parents in", "Parents log in with their mobile number. Your school is in their pocket."],
];

const NEXT = [
  ["bus", "Live bus tracking", "Parents and the school see where the bus is and when it will reach each stop."],
  ["whatsapp", "WhatsApp sign-in", "Parents sign in with a one-time code sent on WhatsApp, with no password to remember."],
  ["newAdmission", "Online enquiries", "A link and QR code for your website and banners. Enquiries land straight in Admissions."],
];

const TRUST = [
  "Data stored in India (Mumbai)",
  "Encrypted in transit and at rest",
  "Only the last 4 digits of Aadhaar are kept",
  "Home locations seen only by owners and admins",
  "Each school’s data is walled off from every other",
];

const LINKS = [
  ["benefits", "Why Godview"],
  ["new", "What’s new"],
  ["features", "Features"],
  ["journey", "How it works"],
  ["privacy", "Privacy"],
];
const LINK_IDS = LINKS.map(([id]) => id);

// Width the hero's dashboard is drawn at; it is scaled to fit the screen.
// Phones show its left part, closer up, so it stays readable.
const homeWidth = () => (window.innerWidth <= 640 ? 720 : 1120);

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

// Page scroll as CSS variables (the hero, the progress bar) and a "scrolled"
// flag for the nav.
function useScrollVars(root) {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const y = window.scrollY;
        const room = document.documentElement.scrollHeight - window.innerHeight;
        if (!reducedMotion()) root.current?.style.setProperty("--scroll", String(y));
        root.current?.style.setProperty("--progress", String(room <= 0 ? 0 : y >= room - 1 ? 1 : y / room));
        setScrolled(y > 12);
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

// Scales a fixed-width drawing to the width of its box, as --k.
function useFit(box, width) {
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const fit = () => el.style.setProperty("--k", String(Math.min(1, el.clientWidth / width())));
    fit();
    if (!("ResizeObserver" in window)) return;
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [box, width]);
}

// The nav link of the section in the middle of the screen.
function useSpy(ids) {
  const [on, setOn] = useState(null);
  useEffect(() => {
    if (!("IntersectionObserver" in window)) return;
    const io = new IntersectionObserver(
      (entries) =>
        entries.forEach((e) =>
          setOn((cur) => (e.isIntersecting ? e.target.id : cur === e.target.id ? null : cur))
        ),
      { rootMargin: "-50% 0px -50% 0px" }
    );
    ids.forEach((id) => {
      const el = document.getElementById(id);
      if (el) io.observe(el);
    });
    return () => io.disconnect();
  }, [ids]);
  return on;
}

// Which What's new step is in the middle of the screen.
function useActiveStep(list) {
  const [active, setActive] = useState(0);
  useEffect(() => {
    const steps = list.current?.querySelectorAll("[data-step]") ?? [];
    if (!("IntersectionObserver" in window)) return;
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => e.isIntersecting && setActive(Number(e.target.dataset.step))),
      { rootMargin: "-45% 0px -45% 0px" }
    );
    steps.forEach((s) => io.observe(s));
    return () => io.disconnect();
  }, [list]);
  return active;
}

// A heading whose words rise into place one after another once it's in view.
function Words({ text }) {
  return text.split(" ").map((w, i) => (
    <span key={i}>
      {i > 0 && " "}
      <span className="lp-w" style={{ "--w": i }}>
        <span>{w}</span>
      </span>
    </span>
  ));
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

function Checks({ points }) {
  return (
    <ul className="lp-checks">
      {points.map((p, i) => (
        <li key={p} style={{ "--i": i }}>
          <Icon name="check" size={16} />
          {p}
        </li>
      ))}
    </ul>
  );
}

// Section title: a hairline, the kicker, the heading and an optional line.
function Head({ kicker, title, sub, light }) {
  return (
    <div className="lp-head" data-reveal>
      <span className={`lp-kicker${light ? " lp-kicker-light" : ""}`}>{kicker}</span>
      <h2 className="lp-h2">
        <Words text={title} />
      </h2>
      {sub && <p className="lp-sub">{sub}</p>}
    </div>
  );
}

// --------------------------------------------------------------- page ---

export default function Landing({ onLogin, onParentLogin, error, busy }) {
  const root = useRef(null);
  const steps = useRef(null);
  const screen = useRef(null);
  useReveal(root);
  const scrolled = useScrollVars(root);
  const spied = useSpy(LINK_IDS);
  const step = useActiveStep(steps);
  useFit(screen, homeWidth);
  const toStep = (i) =>
    steps.current
      ?.querySelector(`[data-step="${i}"]`)
      ?.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "center" });

  const secondCta = parentLoginLive ? (
    <button className="btn lp-btn-lg lp-ghost" onClick={onParentLogin}>
      <Icon name="phone" />
      I’m a parent
    </button>
  ) : (
    <button className="btn lp-btn-lg lp-ghost" onClick={onLogin} disabled={busy}>
      Join with a school code
    </button>
  );

  return (
    <div className="lp" ref={root}>
      <a className="lp-announce" href="#new">
        <span className="lp-announce-tag">New</span>
        Admissions, certificates and letters
        <Icon name="arrowRight" size={14} />
      </a>

      <header className={`lp-nav${scrolled ? " is-scrolled" : ""}`}>
        <div className="lp-wrap lp-nav-inner">
          <a className="logo" href="/" aria-label="Godview home">
            <LogoMark size={28} />
            <span className="logo-word">Godview</span>
          </a>
          <nav className="lp-links" aria-label="Page">
            {LINKS.map(([id, label]) => (
              <a key={id} href={`#${id}`} className={spied === id ? "is-on" : ""}>
                {label}
              </a>
            ))}
          </nav>
          <div className="lp-nav-actions">
            {parentLoginLive && (
              <button className="btn lp-parent" onClick={onParentLogin}>
                Parent login
              </button>
            )}
            <button className="btn lp-login" onClick={onLogin} disabled={busy}>
              Log in
            </button>
          </div>
        </div>
        <span className="lp-progress" aria-hidden="true" />
      </header>

      <main>
        {/* ------------------------------------------------------- hero */}
        <section className="lp-hero">
          <div className="lp-sky" aria-hidden="true">
            <span className="lp-aurora lp-aurora-1" />
            <span className="lp-aurora lp-aurora-2" />
            <span className="lp-aurora lp-aurora-3" />
            <span className="lp-stars" />
            <span className="lp-stars lp-stars-2" />
            <span className="lp-horizon" />
          </div>

          <div className="lp-wrap lp-hero-copy">
            <h1 className="lp-enter" style={{ "--d": "80ms" }}>
              See every
              <br />
              <RotatingWord />
              <br />
              at a glance.
            </h1>
            <p className="lp-lead lp-enter" style={{ "--d": "160ms" }}>
              One app for your whole school. Made for India.
            </p>
            <div className="lp-cta lp-enter" style={{ "--d": "240ms" }}>
              <button className="btn lp-btn-lg lp-solid lp-shine" onClick={onLogin} disabled={busy}>
                Log in with Google
                <Icon name="arrowRight" size={16} className="lp-arrow" />
              </button>
              {secondCta}
            </div>
            {error && <p className="field-error">{error}</p>}
          </div>

          <div className="lp-wrap lp-stage">
            <div className="lp-enter lp-stage-in" style={{ "--d": "420ms" }}>
              <div className="lp-window" aria-hidden="true">
                <div className="lp-window-bar">
                  <span className="lp-dot" />
                  <span className="lp-dot" />
                  <span className="lp-dot" />
                  <span className="lp-url">godview.in</span>
                </div>
                <div className="lp-screen" ref={screen}>
                  <div className="lp-screen-inner">
                    <HomeMock />
                  </div>
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
                  <Icon name="bell" size={14} />
                </span>
                <div>
                  <strong>Grade 3 · Attendance</strong>
                  <span>38 of 40 present today</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ---------------------------------------------------- marquee */}
        <div className="lp-marquee" aria-label="What Godview covers">
          <p className="lp-marquee-cap">One app for the whole school</p>
          <div className="lp-marquee-row">
            <div className="lp-marquee-track">
              {[...MARQUEE, ...MARQUEE].map((m, i) => (
                <span key={i} aria-hidden={i >= MARQUEE.length}>
                  <i className="lp-marquee-dot" />
                  {m}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* --------------------------------------------------- benefits */}
        <section id="benefits" className="lp-section">
          <div className="lp-wrap">
            <Head kicker="Why Godview" title="Everything your school runs on, beautifully simple." />
            <div className="lp-grid">
              {BENEFITS.map(([icon, title, body], i) => (
                <article
                  key={title}
                  className="lp-card"
                  data-reveal="blur"
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

        {/* -------------------------------------------------- what's new */}
        <section id="new" className="lp-section lp-new lp-band-cool">
          <div className="lp-wrap">
            <Head kicker="What’s new" title="The whole office, now in Godview." />
            <div className="lp-new-body">
              <div className="lp-new-steps" ref={steps}>
                {NEW.map((f, i) => (
                  <article key={f.title} className={`lp-new-step${step === i ? " is-on" : ""}`} data-step={i}>
                    <div className="lp-new-inline" data-reveal="zoom">
                      <f.mock />
                    </div>
                    <div data-reveal>
                      <span className="lp-kicker">{f.kicker}</span>
                      <h3 className="lp-h2">{f.title}</h3>
                      <p className="lp-sub">{f.body}</p>
                      <Checks points={f.points} />
                    </div>
                  </article>
                ))}
              </div>
              <div className="lp-new-stage" aria-hidden="true">
                <div className="lp-new-sticky">
                  {NEW.map((f, i) => (
                    <div
                      key={f.title}
                      className={`lp-new-frame${i === step ? " is-on" : i < step ? " is-past" : ""}`}
                    >
                      <f.mock />
                    </div>
                  ))}
                  <div className="lp-new-dots">
                    {NEW.map((f, i) => (
                      <button
                        key={f.title}
                        type="button"
                        tabIndex={-1}
                        className={i === step ? "is-on" : ""}
                        onClick={() => toStep(i)}
                        aria-label={f.kicker}
                      />
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ------------------------------------------------- spotlights */}
        <section id="features" className="lp-section lp-spotlights">
          <div className="lp-wrap">
            <Head kicker="Features" title="Built for the way schools really run." />
            {SPOTLIGHTS.map((s, i) => (
              <div key={s.title} className={`lp-spot${i % 2 ? " is-flipped" : ""}`}>
                <div className="lp-spot-media" data-reveal={i % 2 ? "right" : "left"}>
                  <s.mock />
                </div>
                <div className="lp-spot-copy" data-reveal style={{ "--d": "120ms" }}>
                  <span className="lp-kicker">{s.kicker}</span>
                  <h3 className="lp-h2">
                    <Words text={s.title} />
                  </h3>
                  <p className="lp-sub">{s.body}</p>
                  <Checks points={s.points} />
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ---------------------------------------------------- journey */}
        <section id="journey" className="lp-section lp-band-warm">
          <div className="lp-wrap">
            <Head kicker="How it works" title="From first import to a school that runs itself." />
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
            <Head
              kicker="Roles"
              title="The right access for every person."
              sub="Access rules are enforced by the database itself, not just hidden buttons."
            />
            <div className="lp-roles">
              {ROLES.map(([role, text], i) => (
                <div key={role} className="lp-role" data-reveal="flip" style={{ "--d": `${i * 100}ms` }}>
                  <span className="tag">{role}</span>
                  <p>{text}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ------------------------------------------------------- next */}
        <section className="lp-section lp-band-cool">
          <div className="lp-wrap">
            <Head
              kicker="On the way"
              title="Coming next."
              sub="What we’re building now, on top of everything your school already has."
            />
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

        {/* ------------------------------------------- privacy and end */}
        <div className="lp-dark">
          <section id="privacy" className="lp-section">
            <div className="lp-wrap">
              <Head
                light
                kicker="Privacy"
                title="Built to protect children’s data."
                sub="Student records belong to the school. Godview keeps them private, in India, and visible only to the people who need them."
              />
              <ul className="lp-trust">
                {TRUST.map((t, i) => (
                  <li key={t} data-reveal="right" style={{ "--d": `${i * 90}ms` }}>
                    <span className="lp-trust-icon">
                      <Icon name="check" size={16} />
                    </span>
                    {t}
                  </li>
                ))}
              </ul>
            </div>
          </section>

          <section className="lp-final">
            <div className="lp-wrap">
              <div className="lp-final-card" data-reveal="zoom">
                <div className="lp-confetti" aria-hidden="true">
                  {Array.from({ length: 28 }, (_, i) => (
                    <i key={i} style={{ "--i": i, left: `${(i * 37 + 11) % 100}%` }} />
                  ))}
                </div>
                <h2 className="lp-h2">
                  <Words text="Every school deserves to shine." />
                </h2>
                <p className="lp-sub">Bring your staff, parents, fees and results together and see your school clearly.</p>
                <div className="lp-cta">
                  <button className="btn lp-btn-lg lp-solid lp-shine" onClick={onLogin} disabled={busy}>
                    Log in with Google
                    <Icon name="arrowRight" size={16} className="lp-arrow" />
                  </button>
                  {secondCta}
                </div>
              </div>
            </div>
          </section>

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
      </main>
    </div>
  );
}
