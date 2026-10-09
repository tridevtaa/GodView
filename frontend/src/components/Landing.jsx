import { LogoMark } from "./Logo.jsx";
import Icon from "./Icon.jsx";

// Public page at godview.in for anyone not signed in. Everything here
// describes what Godview actually does today — no invented customers,
// numbers or certifications.

const BENEFITS = [
  {
    icon: "search",
    title: "Every student, one tap away",
    body: "Photo tiles for the whole school. Search by name, parent, admission number or phone, and filter by grade in a second.",
  },
  {
    icon: "upload",
    title: "Bring your data in minutes",
    body: "Import the student export from your current ERP. Classes, parents, photos and admission details come across in one go.",
  },
  {
    icon: "check",
    title: "Session after session",
    body: "Each academic year keeps its own classes and sections. Promote with a new import and look back at past sessions any time.",
  },
  {
    icon: "file",
    title: "Fees at a glance",
    body: "See total pending dues and which students owe what, broken down by month and fee head.",
  },
  {
    icon: "edit",
    title: "Notes and results",
    body: "Teachers record exam marks and notes for their own students. Totals and percentages are worked out for you.",
  },
  {
    icon: "camera",
    title: "Works on any device",
    body: "Phones, tablets and laptops — nothing to install. Staff sign in with their Google account.",
  },
];

const ROLES = [
  ["Owner", "Runs the school on Godview: approves staff, assigns classes, edits the school profile and approves exports."],
  ["Admin", "Manages students, imports, fees and employees. Data exports need the owner’s approval."],
  ["Teacher", "Sees only their own classes, without parents’ phone numbers or addresses. Updates photos, notes and results."],
];

const TRUST = [
  "Data stored in India (Mumbai)",
  "Encrypted in transit and at rest",
  "Only the last 4 digits of Aadhaar are kept",
  "Each school’s data is walled off from every other",
];

const STEPS = [
  ["Import your students", "Upload the Excel export from your current system."],
  ["Invite your staff", "Share your school’s join code. You approve each request and pick their classes."],
  ["Run your school", "Everyone sees exactly what their role allows — nothing more."],
];

// A drawn preview of the student grid (initials, not real photos).
const PREVIEW = [
  ["AS", "Aarav Sharma", "Grade 3", "#dbeafe"],
  ["IK", "Ishita Kaur", "Grade 3", "#fce7f3"],
  ["RV", "Rohan Verma", "Grade 4", "#dcfce7"],
  ["MJ", "Meera Joshi", "Grade 4", "#fef3c7"],
  ["KS", "Kabir Singh", "Grade 5", "#ede9fe"],
  ["AN", "Anaya Negi", "Grade 5", "#e0f2fe"],
];

export default function Landing({ onLogin, error, busy }) {
  return (
    <div className="lp">
      <header className="lp-nav">
        <div className="lp-wrap lp-nav-inner">
          <a className="logo" href="/" aria-label="Godview home">
            <LogoMark size={28} />
            <span className="logo-word">Godview</span>
          </a>
          <nav className="lp-links" aria-label="Page">
            <a href="#benefits">Why Godview</a>
            <a href="#roles">Roles</a>
            <a href="#privacy">Privacy</a>
          </nav>
          <button className="btn btn-primary lp-login" onClick={onLogin} disabled={busy}>
            Log in
          </button>
        </div>
      </header>

      <main>
        <section className="lp-hero">
          <div className="lp-wrap lp-hero-inner">
            <div className="lp-hero-copy">
              <span className="lp-eyebrow">School management for Indian schools</span>
              <h1>See your whole school at a glance.</h1>
              <p className="lp-lead">
                Students, sessions, fees, teachers and results in one simple place — with the right access for every
                role and your data kept in India.
              </p>
              <div className="lp-cta">
                <button className="btn btn-primary lp-btn-lg" onClick={onLogin} disabled={busy}>
                  Log in with Google
                </button>
                <button className="btn btn-secondary lp-btn-lg" onClick={onLogin} disabled={busy}>
                  Join with a school code
                </button>
              </div>
              {error && <p className="field-error">{error}</p>}
              <p className="lp-note">Staff: sign in with Google, then enter the join code from your school office.</p>
            </div>

            <div className="lp-preview" aria-hidden="true">
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
                {PREVIEW.map(([ini, name, grade, tint]) => (
                  <div key={name} className="lp-tile">
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
          </div>
        </section>

        <section id="benefits" className="lp-section">
          <div className="lp-wrap">
            <h2 className="lp-h2">Why schools use Godview</h2>
            <div className="lp-grid">
              {BENEFITS.map((b) => (
                <article key={b.title} className="lp-card">
                  <span className="lp-icon">
                    <Icon name={b.icon} size={20} />
                  </span>
                  <h3>{b.title}</h3>
                  <p>{b.body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="roles" className="lp-section lp-section-alt">
          <div className="lp-wrap">
            <h2 className="lp-h2">The right access for every role</h2>
            <p className="lp-sub">Access rules are enforced by the database itself, not just hidden buttons.</p>
            <div className="lp-roles">
              {ROLES.map(([role, text]) => (
                <div key={role} className="lp-role">
                  <span className="tag">{role}</span>
                  <p>{text}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="lp-section">
          <div className="lp-wrap">
            <h2 className="lp-h2">Up and running in an afternoon</h2>
            <ol className="lp-steps">
              {STEPS.map(([title, text], i) => (
                <li key={title}>
                  <span className="lp-step-num">{i + 1}</span>
                  <div>
                    <h3>{title}</h3>
                    <p>{text}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section id="privacy" className="lp-section lp-section-alt">
          <div className="lp-wrap lp-privacy">
            <div>
              <h2 className="lp-h2">Built to protect children’s data</h2>
              <p className="lp-sub">
                Student records belong to the school. Godview keeps them private, in India, and visible only to the
                people who need them.
              </p>
            </div>
            <ul className="lp-trust">
              {TRUST.map((t) => (
                <li key={t}>
                  <Icon name="check" size={18} />
                  {t}
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="lp-section lp-final">
          <div className="lp-wrap">
            <h2 className="lp-h2">Ready to see your school clearly?</h2>
            <button className="btn btn-primary lp-btn-lg" onClick={onLogin} disabled={busy}>
              Log in with Google
            </button>
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
