import { useCallback, useState } from "react";
import { logOut, switchSchool, useAuth } from "./AuthGate.jsx";
import { useDismiss } from "./useDismiss.js";
import Icon from "./Icon.jsx";
import { HapticsMenuItem, NotifyMenuItem } from "./Notify.jsx";

export default function AccountMenu({ onSettings, onProfile }) {
  const { user, school, role, schools = [] } = useAuth();
  const ROLE = { owner: "Owner", admin: "Admin", principal: "Principal", teacher: "Teacher" };
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
              {ROLE[role]} · {school?.name}
            </div>
          </div>
          {/* In more than one school: switch to another */}
          {schools
            .filter((m) => m.school.id !== school?.id)
            .map((m) => (
              <button key={m.school.id} role="menuitem" className="menu-item" onClick={() => switchSchool(m.school.id)}>
                <Icon name="home" />
                <span className="menu-item-text">
                  Switch to {m.school.short_name || m.school.name}
                  <span className="menu-item-sub">{ROLE[m.role]}</span>
                </span>
              </button>
            ))}
          {onProfile && (
            <button
              role="menuitem"
              className="menu-item"
              onClick={() => {
                setOpen(false);
                onProfile();
              }}
            >
              <Icon name="idcard" />
              My profile
            </button>
          )}
          {onSettings && (
            <button
              role="menuitem"
              className="menu-item"
              onClick={() => {
                setOpen(false);
                onSettings();
              }}
            >
              <Icon name="settings" />
              School settings
            </button>
          )}
          <NotifyMenuItem />
          <HapticsMenuItem />
          <button role="menuitem" className="menu-item" onClick={logOut}>
            <Icon name="logout" />
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
