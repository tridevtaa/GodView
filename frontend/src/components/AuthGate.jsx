import { createContext, useContext, useEffect, useState } from "react";
import { supabase } from "../supabase.js";
import { listMemberships } from "../data/api.js";
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
          <>
            <h1>No access</h1>
            <p className="muted">
              {state.user.email} isn’t a member of any school on Godview. Ask your school’s administrator to add you.
            </p>
            <button className="btn btn-secondary btn-block" onClick={logOut}>
              Use a different account
            </button>
          </>
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
