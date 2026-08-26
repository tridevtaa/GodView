import React from "react";

export default function ProfileSection({ title, children }) {
  return (
    <div className="profile-section">
      <h3>{title}</h3>
      {children}
    </div>
  );
}
