import { useState } from "react";
import { parentPasswordLogin } from "../data/api.js";
import { LogoMark } from "./Logo.jsx";
import Icon from "./Icon.jsx";
import "./parent.css";

const MESSAGES = {
  wrong: "That number and password didn’t match. Use the mobile number the school has, and your child’s first name and birth year, like ishita2016.",
  locked: "Too many tries for this number. Please wait 15 minutes and try again.",
  custom: "You’ve set your own password for this number. Use that one, or ask the school office for help.",
  error: "Couldn’t log in right now. Check your connection and try again.",
};

// Parents log in with the mobile number the school has on record and a
// password: to start with, their child's first name and birth year (e.g.
// ishita2016). They can choose their own password inside the app.
export default function ParentSignIn({ onBack }) {
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const digits = phone.replace(/\D/g, "").slice(-10);
  const valid = /^[6-9]\d{9}$/.test(digits) && password.trim().length >= 5;

  async function submit(e) {
    e.preventDefault();
    if (!valid) return;
    setBusy(true);
    setError("");
    try {
      await parentPasswordLogin(digits, password);
      // AuthGate picks up the new session and opens the parent home.
    } catch (err) {
      setError(MESSAGES[err.message] ?? MESSAGES.error);
      setBusy(false);
    }
  }

  return (
    <main data-clarity-mask="True" className="auth-screen pa-auth">
      <div className="auth-card pa-signin">
        <div className="pa-signin-mark">
          <LogoMark size={40} />
        </div>
        <form onSubmit={submit} className="pa-signin-form">
          <h1>Parent login</h1>
          <p className="muted">Use the mobile number your child’s school has on record.</p>
          <label className="pa-field-label" htmlFor="pa-phone">
            Mobile number
          </label>
          <label className="pa-phone">
            <span className="pa-cc">+91</span>
            <input
              id="pa-phone"
              inputMode="numeric"
              autoComplete="username"
              placeholder="98765 43210"
              value={phone}
              onChange={(e) => setPhone(e.target.value.replace(/[^\d ]/g, "").slice(0, 11))}
              autoFocus
            />
          </label>
          <label className="pa-field-label" htmlFor="pa-password">
            Password
          </label>
          <span className="pa-password">
            <input
              id="pa-password"
              type={show ? "text" : "password"}
              autoComplete="current-password"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              placeholder="e.g. ishita2016"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button type="button" className="link-btn" onClick={() => setShow((s) => !s)}>
              {show ? "Hide" : "Show"}
            </button>
          </span>
          <p className="pa-hint-text">
            <Icon name="check" size={13} /> First time? Your password is your child’s first name and the year they were born, like <strong>ishita2016</strong>.
          </p>
          {error && <p className="field-error">{error}</p>}
          <button className="btn btn-primary btn-block" disabled={busy || !valid}>
            {busy ? "Logging in…" : "Log in"}
          </button>
        </form>
        <button type="button" className="link-btn pa-back" onClick={onBack}>
          <Icon name="arrowLeft" size={14} /> Back
        </button>
        <p className="pa-staff">
          School staff? <button className="link-btn" onClick={onBack}>Log in with Google</button>
        </p>
      </div>
    </main>
  );
}
