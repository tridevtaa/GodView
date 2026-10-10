import { useEffect, useRef, useState } from "react";
import { sendParentCode, verifyParentCode } from "../data/api.js";
import { LogoMark } from "./Logo.jsx";
import Icon from "./Icon.jsx";
import "./parent.css";

const RESEND_AFTER = 30; // seconds

// Parents sign in with the mobile number the school has on record: we send a
// 6-digit code on WhatsApp, they type it in. No password, no Google account.
export default function ParentSignIn({ onBack }) {
  const [step, setStep] = useState("phone"); // phone | code
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [wait, setWait] = useState(0);
  const codeInput = useRef(null);
  const digits = phone.replace(/\D/g, "");
  const valid = /^[6-9]\d{9}$/.test(digits);

  useEffect(() => {
    if (!wait) return;
    const t = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  useEffect(() => {
    if (step === "code") codeInput.current?.focus();
  }, [step]);

  async function send(e) {
    e?.preventDefault();
    if (!valid) return setError("Enter your 10-digit mobile number.");
    setBusy(true);
    setError("");
    try {
      await sendParentCode(digits);
      setStep("code");
      setCode("");
      setWait(RESEND_AFTER);
    } catch (err) {
      setError(
        /rate|seconds|too many/i.test(err?.message ?? "")
          ? "Please wait a little before asking for another code."
          : /phone.*(disabled|provider)|unsupported/i.test(err?.message ?? "")
            ? "Parent sign-in isn’t switched on for this school yet. Please check with the school office."
            : "Couldn’t send the code. Check the number and try again."
      );
    } finally {
      setBusy(false);
    }
  }

  async function verify(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await verifyParentCode(digits, code);
      // AuthGate picks up the new session and opens the parent home.
    } catch (err) {
      setError(/expired/i.test(err?.message ?? "") ? "That code has expired. Ask for a new one." : "That code didn’t match. Check it and try again.");
      setBusy(false);
    }
  }

  return (
    <main className="auth-screen pa-auth">
      <div className="auth-card pa-signin">
        <div className="pa-signin-mark">
          <LogoMark size={40} />
        </div>
        {step === "phone" ? (
          <form onSubmit={send} className="pa-signin-form">
            <h1>Parent login</h1>
            <p className="muted">Use the mobile number your child’s school has on record. We’ll send a code on WhatsApp.</p>
            <label className="pa-phone">
              <span className="pa-cc">+91</span>
              <input
                inputMode="numeric"
                autoComplete="tel-national"
                placeholder="98765 43210"
                value={phone}
                onChange={(e) => setPhone(e.target.value.replace(/[^\d ]/g, "").slice(0, 11))}
                aria-label="Mobile number"
                autoFocus
              />
            </label>
            {error && <p className="field-error">{error}</p>}
            <button className="btn btn-primary btn-block pa-wa" disabled={busy || !valid}>
              <Icon name="message" />
              {busy ? "Sending…" : "Send code on WhatsApp"}
            </button>
          </form>
        ) : (
          <form onSubmit={verify} className="pa-signin-form">
            <h1>Enter the code</h1>
            <p className="muted">
              We sent a 6-digit code on WhatsApp to <strong>+91 {digits.slice(0, 5)} {digits.slice(5)}</strong>.
            </p>
            <input
              ref={codeInput}
              className="pa-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="••••••"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              aria-label="Sign-in code"
            />
            {error && <p className="field-error">{error}</p>}
            <button className="btn btn-primary btn-block" disabled={busy || code.length !== 6}>
              {busy ? "Checking…" : "Log in"}
            </button>
            <div className="pa-signin-links">
              <button type="button" className="link-btn" onClick={() => (setStep("phone"), setError(""))}>
                Change number
              </button>
              <button type="button" className="link-btn" onClick={send} disabled={busy || wait > 0}>
                {wait > 0 ? `Resend in ${wait}s` : "Resend code"}
              </button>
            </div>
          </form>
        )}
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
