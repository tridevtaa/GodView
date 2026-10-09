import { createContext, useContext, useEffect, useState } from "react";
import { supabase } from "../supabase.js";
import { listMemberships, lookupJoinCode, requestAccess } from "../data/api.js";
import ClassPicker from "./ClassPicker.jsx";
import { LogoMark } from "./Logo.jsx";

// { user: { email, displayName, photoURL }, school: { id, name, slug }, role }
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
function RequestAccess({ user }) {
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

export default function AuthGate({ children }) {
  const [state, setState] = useState({ status: "loading" });
  const [error, setError] = useState("");

  useEffect(() => {
    clearLegacyCaches();
    let current = null;

    async function resolve(session) {
      const u = session?.user;
      if (!u) return setState({ status: "signed-out" });
      if (current === u.id) return; // token refreshes re-fire this
      current = u.id;
      setState({ status: "checking" });
      try {
        const memberships = await listMemberships(u.email);
        if (!memberships.length) return setState({ status: "denied", user: toUser(u) });
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
    return (
      <AuthContext.Provider value={{ user: state.user, school: state.school, role: state.role }}>
        {children}
      </AuthContext.Provider>
    );
  }

  return (
    <main className="auth-screen">
      <div className="auth-card">
        <LogoMark size={44} />
        {state.status === "loading" || state.status === "checking" ? (
          <p className="muted">Checking access…</p>
        ) : state.status === "denied" ? (
          <RequestAccess user={state.user} />
        ) : (
          <>
            <h1>Sign in to Godview</h1>
            <p className="muted">Use your school Google account. Access is limited to staff.</p>
            <button className="btn btn-primary btn-block" onClick={signIn}>
              Continue with Google
            </button>
            {error && <p className="field-error">{error}</p>}
          </>
        )}
      </div>
    </main>
  );
}
