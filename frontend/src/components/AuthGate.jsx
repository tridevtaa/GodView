import { createContext, useContext, useEffect, useState } from "react";
import { GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { auth, clearLocalData, db } from "../firebase.js";
import { LogoMark } from "./Logo.jsx";

const UserContext = createContext(null);
export const useUser = () => useContext(UserContext);
// Signing out also wipes the cached student data from this browser, so it
// isn't left behind on shared school computers.
export async function logOut() {
  await signOut(auth);
  await clearLocalData();
  window.location.reload();
}

// Staff access is an allowlist: a document in "staff" whose id is the
// lowercased email. Firestore rules enforce the same check server-side.
async function isStaff(user) {
  if (!user.emailVerified || !user.email) return false;
  try {
    return (await getDoc(doc(db, "staff", user.email.toLowerCase()))).exists();
  } catch {
    return false;
  }
}

export default function AuthGate({ children }) {
  const [state, setState] = useState({ status: "loading" });
  const [error, setError] = useState("");

  useEffect(
    () =>
      onAuthStateChanged(auth, async (user) => {
        if (!user) return setState({ status: "signed-out" });
        setState({ status: "checking" });
        setState((await isStaff(user)) ? { status: "staff", user } : { status: "denied", user });
      }),
    []
  );

  async function signIn() {
    setError("");
    try {
      await signInWithPopup(auth, new GoogleAuthProvider());
    } catch (e) {
      if (e.code !== "auth/popup-closed-by-user") setError("Sign-in failed. Please try again.");
    }
  }

  if (state.status === "staff") {
    return <UserContext.Provider value={state.user}>{children}</UserContext.Provider>;
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
              {state.user.email} isn’t on the staff list. Ask an administrator to add you.
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
