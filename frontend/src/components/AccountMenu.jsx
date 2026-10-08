import { useEffect, useRef, useState } from "react";
import { logOut, useUser } from "./AuthGate.jsx";

export default function AccountMenu() {
  const user = useUser();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const close = (e) => {
      if (e.type === "keydown" ? e.key === "Escape" : !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  return (
    <div className="account" ref={ref}>
      <button className="account-btn" aria-label="Account" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true">
          <circle cx="12" cy="7" r="5" />
          <path d="M2 23c0-6 4.5-9 10-9s10 3 10 9z" />
        </svg>
      </button>
      {open && (
        <div className="account-menu" role="menu">
          <div className="account-email">{user?.email}</div>
          <button role="menuitem" onClick={logOut}>
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
