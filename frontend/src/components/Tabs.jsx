import React from "react";

// Small sub-navigation used inside a module page to switch between two or
// three related views (e.g. Fee Structure / Payments) without a route change.
export default function Tabs({ tabs, active, onChange }) {
  return (
    <div className="excel-tabs module-tabs">
      {tabs.map((t) => (
        <button
          key={t.key}
          type="button"
          className={active === t.key ? "active" : ""}
          onClick={() => onChange(t.key)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
