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
          {/* Their name at the top opens My profile */}
          <button
            role="menuitem"
            className="menu-header menu-header-link"
            onClick={() => {
              setOpen(false);
              onProfile?.();
            }}
            disabled={!onProfile}
          >
            {user?.displayName && <span className="menu-title">{user.displayName}</span>}
            <span className="menu-subtitle">{user?.email}</span>
            <span className="menu-subtitle">
              {ROLE[role]} · {school?.name}
            </span>
            {onProfile && (
              <span className="menu-header-cta">
                My profile <Icon name="chevronRight" size={12} />
              </span>
            )}
          </button>
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
