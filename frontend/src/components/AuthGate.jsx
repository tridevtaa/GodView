import { Suspense, createContext, lazy, useContext, useEffect, useState } from "react";
import { supabase } from "../supabase.js";
import { listMemberships, logoUrl, lookupJoinCode, myAccessRequests, requestAccess, uploadStaffDocument } from "../data/api.js";
import { saveJoinPhoto } from "../data/photos.js";
import { gradeLabel } from "./PersonCard.jsx";
import { LogoMark } from "./Logo.jsx";
import ParentSignIn from "./ParentSignIn.jsx";
import { StepBar } from "./Steps.jsx";
import Icon from "./Icon.jsx";
import { isStandalone, parentLoginLive } from "../pwa/install.js";

// Parents get their own, separate screens (loaded only for them).
const ParentApp = lazy(() => import("./ParentApp.jsx"));
// The landing page only loads for visitors who aren't signed in.
const Landing = lazy(() => import("./Landing.jsx"));

// { user: { email, displayName, photoURL }, school, role, setSchool }
const AuthContext = createContext(null);
export const useAuth = () => useContext(AuthContext);
export const useUser = () => useContext(AuthContext)?.user;

// The Firebase version of the app cached student records in IndexedDB
// ("firestore/…" databases) and kept sync markers ("godview.sync.…",
// "firebase:…"). Remove those on every start so no copy lingers on shared
// computers. Only those: today's settings also start with "godview." (a
// dismissed prompt, saved photo links…) and must survive a restart.
// all: on sign-out, clear every "godview." setting too.
async function clearLegacyCaches(all = false) {
  try {
    const dbs = (await indexedDB.databases?.()) ?? [];
    dbs.filter((d) => d.name?.startsWith("firestore/")).forEach((d) => indexedDB.deleteDatabase(d.name));
    Object.keys(localStorage)
      .filter((k) => k.startsWith("godview.sync.") || k.startsWith("firebase:") || (all && k.startsWith("godview.")))
      .forEach((k) => localStorage.removeItem(k));
  } catch {
    // Storage blocked; nothing to clear.
  }
}

// For staff in more than one school: which one to open (this device only).
const SCHOOL_KEY = "gv-school";
const chosenSchool = () => {
  try {
    return localStorage.getItem(SCHOOL_KEY);
  } catch {
    return null;
  }
};

// Opens another of this person's schools: remembered, then a fresh start,
// so nothing from the first school stays on screen.
export function switchSchool(id) {
  try {
    localStorage.setItem(SCHOOL_KEY, id);
  } catch {
    // can't remember it: the reload still opens the first school
  }
  window.location.reload();
}

export async function logOut() {
  // This device stops getting the person's notifications (while still
  // signed in, so the database lets us remove it).
  await import("../pwa/push.js").then((p) => p.disablePush()).catch(() => {});
  await supabase.auth.signOut();
  // Photos kept on this device go with the session (shared computers).
  await globalThis.caches?.delete("godview-photos-v2").catch(() => {});
  // So is everything remembered for speed (lists, photo links).
  await import("../data/cache.js").then((c) => c.clearCache()).catch(() => {});
  try {
    localStorage.removeItem("godview.signed");
  } catch {
    // nothing stored
  }
  await clearLegacyCaches(true);
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

const ADDRESS_PROOF_TYPES = [
  ["aadhaar", "Aadhaar card"],
  ["pan", "PAN card"],
  ["dl", "Driving licence"],
  ["passport", "Passport"],
  ["voter_id", "Voter ID"],
  ["other", "Other"],
];

// Shown to someone signed in who isn't a member of any school yet:
// 1) enter the school's join code, 2) details and classes, 3) sent.
export function RequestAccess({ user, onSchool }) {
  const [step, setStep] = useState("code");
  const [code, setCode] = useState("");
  const [school, setSchool] = useState(null); // { school_name, session_name, classes }
  const [form, setForm] = useState({
    fullName: user.displayName || "",
    designation: "Teacher",
    phone: "",
    subjects: "",
    note: "",
    photoPath: "",
    policyAgreed: false,
    idProofPath: "",
    addressProofType: "",
    addressProofPath: "",
    educationCertPath: "",
  });
  const [photo, setPhoto] = useState({ preview: "", busy: false, error: "" });
  // Documents, keyed by kind (id_proof, address_proof, education_cert):
  // { name, busy, error }. The saved path lives on `form` once uploaded.
  const [docs, setDocs] = useState({});
  // The details come in four short screens: photo, about you, the school's
  // policy (if it has one), then the KYC documents. Classes come later,
  // from the dashboard, once the owner has approved access.
  const [part, setPart] = useState(0);

  async function pickPhoto(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setPhoto({ preview: URL.createObjectURL(file), busy: true, error: "" });
    try {
      const photoPath = await saveJoinPhoto(file);
      setForm((f) => ({ ...f, photoPath }));
      setPhoto((p) => ({ ...p, busy: false }));
    } catch (err) {
      console.error("[join-photo]", err);
      setForm((f) => ({ ...f, photoPath: "" }));
      setPhoto({ preview: "", busy: false, error: "Couldn’t save that photo. Try another one." });
    }
  }
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const PATH_FIELD = { id_proof: "idProofPath", address_proof: "addressProofPath", education_cert: "educationCertPath" };
  async function pickDocument(kind, e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setDocs((d) => ({ ...d, [kind]: { name: file.name, busy: true, error: "" } }));
    try {
      const path = await uploadStaffDocument(kind, file);
      setForm((f) => ({ ...f, [PATH_FIELD[kind]]: path }));
      setDocs((d) => ({ ...d, [kind]: { name: file.name, busy: false, error: "" } }));
    } catch {
      setForm((f) => ({ ...f, [PATH_FIELD[kind]]: "" }));
      setDocs((d) => ({ ...d, [kind]: { name: "", busy: false, error: "Couldn’t save that file. Use a photo or PDF under 8 MB." } }));
    }
  }

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

  const hasPolicy = Boolean(school?.staff_policy?.trim());
  const docsOk = Boolean(form.idProofPath) && Boolean(form.addressProofType) && Boolean(form.addressProofPath) && Boolean(form.educationCertPath)
    && !Object.values(docs).some((d) => d.busy);
  const partOk = [
    Boolean(form.photoPath) && !photo.busy,
    Boolean(form.fullName.trim() && form.designation.trim()),
    !hasPolicy || form.policyAgreed,
    docsOk,
  ];
  const last = partOk.length - 1;

  async function submit(e) {
    e.preventDefault();
    if (part < last) {
      if (partOk[part]) (setPart(part + 1), setError(""));
      return;
    }
    setBusy(true);
    setError("");
    if (!form.photoPath) {
      setBusy(false);
      return setError("Add a photo of yourself so the school can recognise you.");
    }
    try {
      await requestAccess(code, form);
      setStep("sent");
    } catch (err) {
      const msg = err?.message ?? "";
      setError(
        /photo/i.test(msg)
          ? "Add a photo of yourself so the school can recognise you."
          : /policy/i.test(msg)
          ? "Agree to the school policy first."
          : /proof|certificate/i.test(msg)
          ? "Add the documents below before sending."
          : "Couldn’t send the request. Please try again."
      );
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
      <StepBar steps={["Photo", "About you", "Policy", "Documents"]} step={part} onPick={setPart} canPick={(i) => partOk.slice(0, i).every(Boolean)} />

      {part === 0 && (
        <div className="join-photo join-photo-big">
          <label className={`join-photo-pick${form.photoPath ? " is-set" : ""}`}>
            {photo.preview ? <img src={photo.preview} alt="Your photo" /> : <Icon name="camera" size={30} />}
            <input type="file" accept="image/*" onChange={pickPhoto} hidden />
          </label>
          <span className="row-sub">
            {photo.busy ? "Saving…" : form.photoPath ? "Looks good. Tap it to change." : "A clear photo of your face, so staff and parents recognise you."}
          </span>
          {photo.error && <span className="field-error">{photo.error}</span>}
        </div>
      )}

      {part === 1 && (
        <>
          <label>
            <span>Full name *</span>
            <input value={form.fullName} onChange={set("fullName")} required maxLength={120} autoComplete="name" autoFocus />
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
          <label>
            <span>Note for the owner</span>
            <input value={form.note} onChange={set("note")} maxLength={500} placeholder="Optional" />
          </label>
        </>
      )}

      {part === 2 && (
        <div className="field-block">
          {hasPolicy ? (
            <>
              <span className="field-label">{school.school_name}’s staff policy</span>
              <p className="policy-text">{school.staff_policy}</p>
              <label className="checkbox checkbox-inline">
                <input type="checkbox" checked={form.policyAgreed} onChange={(e) => setForm({ ...form, policyAgreed: e.target.checked })} />
                <span>I’ve read and agree to this policy.</span>
              </label>
            </>
          ) : (
            <p className="row-sub">{school.school_name} hasn’t set a staff policy yet. Nothing to agree to here — tap Next.</p>
          )}
        </div>
      )}

      {part === 3 && (
        <div className="field-block">
          <span className="field-label">Your documents</span>
          <p className="row-sub">A photo or scan of each. These are only seen by {school.school_name}’s owner and admins.</p>
          <DocPicker label="ID proof (Aadhaar / PAN) *" kind="id_proof" doc={docs.id_proof} onPick={pickDocument} />
          <label className="field-block">
            <span>Address proof type *</span>
            <select value={form.addressProofType} onChange={set("addressProofType")} required>
              <option value="">Choose one</option>
              {ADDRESS_PROOF_TYPES.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <DocPicker label="Address proof *" kind="address_proof" doc={docs.address_proof} onPick={pickDocument} />
          <DocPicker label="Education / employment certificate *" kind="education_cert" doc={docs.education_cert} onPick={pickDocument} />
        </div>
      )}

      {error && <p className="field-error">{error}</p>}
      <button className="btn btn-primary btn-block" disabled={busy || !partOk[part]}>
        {part < last ? "Next" : busy ? "Sending…" : "Send request"}
      </button>
      <button type="button" className="btn btn-secondary btn-block" onClick={() => (part > 0 ? setPart(part - 1) : setStep("code"))}>
        Back
      </button>
    </form>
  );
}

// One document upload slot (ID proof, address proof, education/employment
// certificate): a photo or PDF, picked once and replaced by tapping again.
function DocPicker({ label, kind, doc, onPick }) {
  const saved = Boolean(doc?.name) && !doc?.busy && !doc?.error;
  return (
    <label className="field-block doc-pick">
      <span>{label}</span>
      <span className={`doc-pick-box${saved ? " is-set" : ""}`}>
        <Icon name={saved ? "check" : "upload"} size={16} />
        {doc?.busy ? "Saving…" : saved ? doc.name : "Choose a photo or PDF"}
      </span>
      <input type="file" accept="image/*,application/pdf" onChange={(e) => onPick(kind, e)} hidden />
      {doc?.error && <span className="field-error">{doc.error}</span>}
    </label>
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
        // Someone in more than one school opens the one they last chose.
        const { school, role } = memberships.find((m) => m.school.id === chosenSchool()) ?? memberships[0];
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
      <AuthContext.Provider value={{ user: state.user, school: state.school, role: state.role, schools: state.schools, setSchool }}>
        {children}
      </AuthContext.Provider>
    );
  }

  if (state.status === "parent") {
    return (
      <Suspense fallback={<main data-clarity-mask="True" className="auth-screen" aria-busy="true" />}>
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
    return (
      <Suspense fallback={<main className="auth-screen" aria-busy="true" />}>
        <Landing onLogin={signIn} onParentLogin={() => showParentLogin(true)} error={error} />
      </Suspense>
    );
  }

  // Signed-in session still resolving: a quiet screen rather than a flash of
  // the landing page.
  if (state.status === "loading") {
    return <main data-clarity-mask="True" className="auth-screen" aria-busy="true" />;
  }

  return (
    <main data-clarity-mask="True" className="auth-screen">
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
    <main data-clarity-mask="True" className="auth-screen app-welcome">
      <div className="auth-card">
        <span className="app-welcome-mark">
          <LogoMark size={44} />
        </span>
        <h1>Welcome to Godview</h1>
        <p className="muted">Your school, in your pocket.</p>
        {parentLoginLive && (
          <button className="btn btn-primary btn-block app-welcome-btn" onClick={onParent}>
            <Icon name="phone" />
            I’m a parent
          </button>
        )}
        <button className={`btn btn-block app-welcome-btn ${parentLoginLive ? "btn-secondary" : "btn-primary"}`} onClick={onStaff}>
          {parentLoginLive ? "School staff: log in with Google" : "Log in with Google"}
        </button>
        {error && <p className="field-error">{error}</p>}
      </div>
    </main>
  );
}
