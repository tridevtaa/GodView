import React, { useState } from "react";
import { BACKEND_URL, FieldList } from "./entityApi.jsx";

// The Admission detail modal's body: shows the enquiry's fields plus a
// "Convert to Student" action that turns an approved enquiry into a real
// Students record (see POST /admissions/:id/convert on the backend).
export default function AdmissionProfile({ admission, onConverted }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function handleConvert() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `${BACKEND_URL}/admissions/${encodeURIComponent(admission.id)}/convert`,
        { method: "POST" }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Convert failed");
      onConverted?.(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="profile-sections">
      <FieldList item={admission} exclude={["name"]} />

      {admission.status === "Admitted" ? (
        <p className="hint">Already admitted as a student.</p>
      ) : (
        <button type="button" className="btn-primary" onClick={handleConvert} disabled={busy}>
          {busy ? "Converting..." : "Convert to Student"}
        </button>
      )}
      {error && <p className="status-err">{error}</p>}
    </div>
  );
}
