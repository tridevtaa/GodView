import { Suspense, createContext, lazy, useContext, useEffect, useState } from "react";
import { supabase } from "../supabase.js";
import { listMemberships, logoUrl, lookupJoinCode, myAccessRequests, requestAccess } from "../data/api.js";
import { gradeLabel } from "./PersonCard.jsx";
import ClassPicker from "./ClassPicker.jsx";
import { LogoMark } from "./Logo.jsx";
import Landing from "./Landing.jsx";
import ParentSignIn from "./ParentSignIn.jsx";
import Icon from "./Icon.jsx";
import { isStandalone } from "../pwa/install.js";

// Parents get their own, separate screens (loaded only for them).
const ParentApp = lazy(() => import("./ParentApp.jsx"));

// { user: { email, displayName, photoURL }, school, role, setSchool }
const AuthContext = createContext(null);
export const useAuth = () => useContext(AuthContext);
export const useUser = () => useContext(AuthContext)?.user;

// The Firebase version of the app cached student records in IndexedDB
// ("firestore/…" databases). Remove them so no copy lingers on shared computers.
async function clearLegacyCaches() {
  try {
    const dbs = (await indexedDB.databases?.()) ?? [];
    dbs.filter((d) => d.name?.startsWith("firestore/")).forEach((d) => indexedDB.deleteDatabase(d.name));
    Object.keys(localStorage)
      .filter((k) => k.startsWith("godview.") || k.startsWith("firebase:"))
      .forEach((k) => localStorage.removeItem(k));
  } catch {
    // Storage blocked; nothing to clear.
  }
}

export async function logOut() {
  await supabase.auth.signOut();
  await clearLegacyCaches();
  window.location.assign("/");
}

const toUser = (u) => ({
  email: u.email,
  displayName: u.user_metadata?.full_name || u.user_metadata?.name || "",
  photoURL: u.user_metadata?.avatar_url || u.user_metadata?.picture || "",
});

const DESIGNATIONS = [
  "Teacher", "Class teacher", "Subject teacher", "Coordinator", "Vice principal", "Principal",
  "Office staff", "Accountant", "Librarian", "Counsellor",
];

// Shown to someone signed in who isn't a member of any school yet:
// 1) enter the school's join code, 2) details and classes, 3) sent.
function RequestAccess({ user, onSchool }) {
  const [step, setStep] = useState("code");
  const [code, setCode] = useState("");
  const [school, setSchool] = useState(null); // { school_name, session_name, classes }
  const [form, setForm] = useState({
    fullName: user.displayName || "",
    designation: "Teacher",
    phone: "",
    subjects: "",
    note: "",
    classes: [],
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function findSchool(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const found = await lookupJoinCode(code);
      if (!found) setError("That code didn’t match a school. Check it with your school office.");
      else {
        setSchool(found);
        onSchool(found);
        setStep("details");
      }
    } catch {
      setError("Couldn’t check the code. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await requestAccess(code, form);
      setStep("sent");
    } catch {
      setError("Couldn’t send the request. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (step === "sent") {
    return (
      <>
        <h1>Request sent</h1>
        <p className="muted">
          {school.school_name}’s owner will review your request. Once it’s approved, sign in again to see your classes.
        </p>
        <button className="btn btn-secondary btn-block" onClick={logOut}>
          Sign out
        </button>
      </>
    );
  }

  if (step === "code") {
    return (
      <form className="request-form" onSubmit={findSchool}>
        <h1>Join your school</h1>
        <p className="muted">
          {user.email} isn’t part of a school on Godview yet. Enter the join code from your school office.
        </p>
        <label>
          <span>School join code</span>
          <input
            className="code-input"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="e.g. MAV-7K2Q-9XPD"
            autoComplete="off"
            spellCheck={false}
            required
          />
        </label>
        {error && <p className="field-error">{error}</p>}
        <button className="btn btn-primary btn-block" disabled={busy || code.replace(/[^a-z0-9]/gi, "").length < 8}>
          {busy ? "Checking…" : "Continue"}
        </button>
        <button type="button" className="btn btn-secondary btn-block" onClick={logOut}>
          Use a different account
        </button>
      </form>
    );
  }

  return (
    <form className="request-form request-form-wide" onSubmit={submit}>
      <h1>{school.school_name}</h1>
      <p className="muted">Tell the school who you are and which classes you teach.</p>
      <div className="form-grid">
        <label>
          <span>Full name *</span>
          <input value={form.fullName} onChange={set("fullName")} required maxLength={120} autoComplete="name" />
        </label>
        <label>
          <span>Designation *</span>
          <input list="designations" value={form.designation} onChange={set("designation")} required maxLength={80} />
          <datalist id="designations">
            {DESIGNATIONS.map((d) => (
              <option key={d} value={d} />
            ))}
          </datalist>
        </label>
        <label>
          <span>Phone</span>
          <input type="tel" value={form.phone} onChange={set("phone")} maxLength={20} autoComplete="tel" />
        </label>
        <label>
          <span>Subjects you teach</span>
          <input value={form.subjects} onChange={set("subjects")} maxLength={200} placeholder="e.g. Maths, EVS" />
        </label>
      </div>
      <div className="field-block">
        <span className="field-label">
          Your classes{school.session_name ? ` for ${school.session_name}` : ""}
        </span>
        <ClassPicker options={school.classes ?? []} value={form.classes} onChange={(classes) => setForm({ ...form, classes })} />
      </div>
      <label>
        <span>Anything else the owner should know</span>
        <input value={form.note} onChange={set("note")} maxLength={500} placeholder="Optional" />
      </label>
      {error && <p className="field-error">{error}</p>}
      <button className="btn btn-primary btn-block" disabled={busy || !form.fullName.trim() || !form.designation.trim()}>
        {busy ? "Sending…" : "Send request"}
      </button>
      <button type="button" className="btn btn-secondary btn-block" onClick={() => setStep("code")}>
        Back
      </button>
    </form>
  );
}

const when = (iso) => new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
const classList = (classes = []) =>
  classes.map((c) => `${gradeLabel(c.class)}${c.section ? ` · ${c.section}` : ""}`).join(", ");

// For someone signed in without access: their latest request's status, or
// the join form if they haven't asked (or want to ask again / update it).
function JoinStatus({ requests = [], user, onSchool }) {
  const latest = requests[0];
  const [joining, setJoining] = useState(!latest || latest.status === "approved");

  useEffect(() => {
    if (!joining && latest) onSchool(latest);
  }, [joining, latest, onSchool]);

  if (joining) return <RequestAccess user={user} onSchool={onSchool} />;

  const pending = latest.status === "pending";
  return (
    <div className="request-form">
      <h1>{pending ? "Waiting for approval" : "Request not approved"}</h1>
      <p className="muted">
        {pending
          ? `${latest.school_name}’s owner hasn’t reviewed your request yet. You’ll get access as soon as they approve it.`
          : `${latest.school_name} didn’t approve your request${latest.decided_at ? ` on ${when(latest.decided_at)}` : ""}. Check with the school office, then you can ask again.`}
      </p>
      <dl className="summary-list">
        <div>
          <dt>School</dt>
          <dd>{latest.school_name}</dd>
        </div>
        <div>
          <dt>Sent</dt>
          <dd>{when(latest.created_at)}</dd>
        </div>
        {latest.designation && (
          <div>
            <dt>As</dt>
            <dd>{latest.designation}</dd>
          </div>
        )}
        {latest.requested_classes?.length > 0 && (
          <div>
            <dt>Classes</dt>
            <dd className="summary-wrap">{classList(latest.requested_classes)}</dd>
          </div>
        )}
        <div>
          <dt>Status</dt>
          <dd>
            <span className={`badge ${pending ? "badge-warning" : "badge-danger"}`}>{pending ? "Pending" : "Not approved"}</span>
          </dd>
        </div>
      </dl>
      {pending && (
        <button className="btn btn-primary btn-block" onClick={() => window.location.reload()}>
          Check again
        </button>
      )}
      <button
        className={`btn btn-block ${pending ? "btn-secondary" : "btn-primary"}`}
        onClick={() => {
          onSchool(null);
          setJoining(true);
        }}
      >
        {pending ? "Update request" : "Request again"}
      </button>
      <button className="btn btn-secondary btn-block" onClick={logOut}>
        Sign out
      </button>
    </div>
  );
}

export default function AuthGate({ children }) {
  const [state, setState] = useState({ status: "loading" });
  const [error, setError] = useState("");
  const [joinSchool, setJoinSchool] = useState(null); // school found by join code
  const [parentLogin, setParentLogin] = useState(() => window.location.pathname.startsWith("/parent"));
  const showParentLogin = (on) => {
    setParentLogin(on);
    window.history.replaceState(null, "", on ? "/parent" : "/");
  };

  useEffect(() => {
    clearLegacyCaches();
    let current = null;

    async function resolve(session) {
      const u = session?.user;
      if (!u) return setState({ status: "signed-out" });
      if (current === u.id) return; // token refreshes re-fire this
      current = u.id;
      // Parents sign in with a phone number and no email.
      if (u.phone && !u.email) return setState({ status: "parent", phone: u.phone });
      setState({ status: "checking" });
      try {
        const memberships = await listMemberships(u.email);
        if (!memberships.length) {
          const requests = await myAccessRequests().catch(() => []);
          return setState({ status: "denied", user: toUser(u), requests });
        }
        const { school, role } = memberships[0];
        setState({ status: "member", user: toUser(u), school, role, schools: memberships });
      } catch {
        current = null;
        setState({ status: "signed-out" });
        setError("Couldn’t check your access. Please try again.");
      }
    }

    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) current = null;
      // Defer: Supabase must not be called from inside this callback.
      setTimeout(() => resolve(session), 0);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  async function signIn() {
    setError("");
    const { error: err } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin, queryParams: { prompt: "select_account" } },
    });
    if (err) setError("Sign-in failed. Please try again.");
  }

  if (state.status === "member") {
    const setSchool = (school) => setState((s) => ({ ...s, school }));
    return (
      <AuthContext.Provider value={{ user: state.user, school: state.school, role: state.role, setSchool }}>
        {children}
      </AuthContext.Provider>
    );
  }

  if (state.status === "parent") {
    return (
      <Suspense fallback={<main className="auth-screen" aria-busy="true" />}>
        <ParentApp phone={state.phone} />
      </Suspense>
    );
  }

  // Visitors (and anyone signed out) get the public landing page, or the
  // parent sign-in (godview.in/parent or the landing page's Parent login).
  if (state.status === "signed-out") {
    if (parentLogin) return <ParentSignIn onBack={() => showParentLogin(false)} />;
    // Opened from the home screen: an app sign-in, not the marketing page.
    if (isStandalone()) return <AppWelcome onStaff={signIn} onParent={() => showParentLogin(true)} error={error} />;
    return <Landing onLogin={signIn} onParentLogin={() => showParentLogin(true)} error={error} />;
  }

  // Signed-in session still resolving: a quiet screen rather than a flash of
  // the landing page.
  if (state.status === "loading") {
    return <main className="auth-screen" aria-busy="true" />;
  }

  return (
    <main className="auth-screen">
      <div className="auth-card">
        <div className="auth-brand">
          <LogoMark size={44} />
          {joinSchool?.logo_path && (
            <>
              <span className="logo-x" aria-hidden="true">×</span>
              <img className="auth-brand-school" src={logoUrl(joinSchool.logo_path)} alt={joinSchool.school_name} />
            </>
          )}
        </div>
        {state.status === "checking" ? (
          <p className="muted">Checking access…</p>
        ) : (
          <JoinStatus requests={state.requests} user={state.user} onSchool={setJoinSchool} />
        )}
      </div>
    </main>
  );
}

// First screen of the installed app for someone signed out.
function AppWelcome({ onStaff, onParent, error }) {
  return (
    <main className="auth-screen app-welcome">
      <div className="auth-card">
        <span className="app-welcome-mark">
          <LogoMark size={44} />
        </span>
        <h1>Welcome to Godview</h1>
        <p className="muted">Your school, in your pocket.</p>
        <button className="btn btn-primary btn-block app-welcome-btn" onClick={onParent}>
          <Icon name="phone" />
          I’m a parent
        </button>
        <button className="btn btn-secondary btn-block app-welcome-btn" onClick={onStaff}>
          School staff: log in with Google
        </button>
        {error && <p className="field-error">{error}</p>}
      </div>
    </main>
  );
}
