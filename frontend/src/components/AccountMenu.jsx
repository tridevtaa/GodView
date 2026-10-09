import { useCallback, useState } from "react";
import { logOut, useAuth } from "./AuthGate.jsx";
import { useDismiss } from "./useDismiss.js";
import Icon from "./Icon.jsx";

export default function AccountMenu() {
  const { user, school, role } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useDismiss(open, useCallback(() => setOpen(false), []));
  const initial = (user?.displayName || user?.email || "?")[0].toUpperCase();

  return (
    <div className="popover-anchor" ref={ref}>
      <button className="avatar-btn" aria-label="Account" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {user?.photoURL ? <img src={user.photoURL} alt="" referrerPolicy="no-referrer" /> : initial}
      </button>
      {open && (
        <div className="menu menu-right" role="menu">
          <div className="menu-header">
            {user?.displayName && <div className="menu-title">{user.displayName}</div>}
            <div className="menu-subtitle">{user?.email}</div>
            <div className="menu-subtitle">
              {{ owner: "Owner", admin: "Admin", teacher: "Teacher" }[role]} · {school?.name}
            </div>
          </div>
          <button role="menuitem" className="menu-item" onClick={logOut}>
            <Icon name="logout" />
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
