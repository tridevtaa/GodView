import React, { useEffect, useMemo, useState } from "react";

// Set this to your deployed Flask backend URL (e.g. Render free web service),
// or http://localhost:5000 while developing locally.
export const BACKEND_URL =
  import.meta.env.VITE_BACKEND_URL || "http://localhost:5000";

export function useCollectionIds(collection) {
  const [ids, setIds] = useState([]);
  useEffect(() => {
    let cancelled = false;
    fetch(`${BACKEND_URL}/ids/${collection}`)
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled) setIds(data.ids || []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [collection]);
  return ids;
}

// Full documents for a collection — used to join related records (e.g. a
// student's fee payments, attendance, results) onto a profile view.
export function useRecords(collection) {
  const [items, setItems] = useState(null);
  useEffect(() => {
    let cancelled = false;
    fetch(`${BACKEND_URL}/records/${collection}`)
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled) setItems(data.items || []);
      })
      .catch(() => {
        if (!cancelled) setItems([]);
      });
    return () => {
      cancelled = true;
    };
  }, [collection]);
  return items;
}

export function humanize(key) {
  return key
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (s) => s.toUpperCase())
    .trim();
}

export function FieldList({ item, exclude = [] }) {
  return (
    <dl className="directory-detail-fields">
      {Object.entries(item)
        .filter(([k]) => !exclude.includes(k))
        .map(([k, v]) => (
          <React.Fragment key={k}>
            <dt>{humanize(k)}</dt>
            <dd>{v === null || v === undefined || v === "" ? "—" : String(v)}</dd>
          </React.Fragment>
        ))}
    </dl>
  );
}

// Generic one-record-at-a-time form, driven by a small field config.
export function EntityForm({ endpoint, fields, selectOptions = {}, initialValues = {}, onSaved }) {
  const initial = useMemo(
    () => Object.fromEntries(fields.map((f) => [f.name, initialValues[f.name] ?? ""])),
    [fields, initialValues]
  );
  const [values, setValues] = useState(initial);
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);

  function setField(name, val) {
    setValues((v) => ({ ...v, [name]: val }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setStatus(null);

    const body = {};
    fields.forEach((f) => {
      body[f.name] = f.type === "number" ? Number(values[f.name]) : values[f.name];
    });

    try {
      const res = await fetch(`${BACKEND_URL}${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        throw Object.assign(new Error(data.error || "Save failed"), {
          details: data.details,
        });
      }
      setStatus({
        type: "success",
        message: data.id ? `Saved as ${data.id}.` : "Saved.",
      });
      setValues(initial);
      onSaved?.(data);
    } catch (err) {
      setStatus({ type: "error", message: err.message, details: err.details });
    } finally {
      setBusy(false);
    }
  }

  const canSubmit =
    !busy &&
    fields.every((f) => !f.required || String(values[f.name]).trim() !== "");

  return (
    <form className="entity-form" onSubmit={handleSubmit}>
      {fields.map((f) => (
        <label key={f.name}>
          {f.label}
          {f.required ? " *" : ""}
          {f.type === "select" ? (
            <select
              value={values[f.name]}
              onChange={(e) => setField(f.name, e.target.value)}
            >
              <option value="">Select...</option>
              {(selectOptions[f.name] || []).map((opt) => {
                const value = typeof opt === "object" ? opt.value : opt;
                const label = typeof opt === "object" ? opt.label : opt;
                return (
                  <option key={value} value={value}>
                    {label}
                  </option>
                );
              })}
            </select>
          ) : (
            <input
              type={f.type === "number" ? "number" : "text"}
              step={f.type === "number" ? "any" : undefined}
              value={values[f.name]}
              placeholder={f.placeholder}
              onChange={(e) => setField(f.name, e.target.value)}
            />
          )}
        </label>
      ))}

      <button type="submit" disabled={!canSubmit}>
        {busy ? "Saving..." : "Save"}
      </button>

      {status && (
        <div className={status.type === "success" ? "status-ok" : "status-err"}>
          <p>{status.message}</p>
          {status.details && (
            <ul>
              {status.details.map((d, i) => (
                <li key={i}>{d}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </form>
  );
}

// Bulk-upload panel: download a column template, pick a filled-in .xlsx,
// hand it to the backend as-is. The backend already validates every column
// and row, so there's no need to duplicate that parsing on the client.
export function ExcelPanel({ endpoint, templateHint, templateFile, onSaved }) {
  const [file, setFile] = useState(null);
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);

  function handleFileChange(e) {
    setFile(e.target.files[0] || null);
    setStatus(null);
  }

  async function handleUpload() {
    if (!file) return;
    setBusy(true);
    setStatus(null);
    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch(`${BACKEND_URL}${endpoint}`, {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) {
        throw Object.assign(new Error(data.error || "Upload failed"), {
          details: data.details,
        });
      }
      setStatus({
        type: "success",
        message: `Uploaded successfully. ${data.count ?? ""} rows processed.`,
      });
      setFile(null);
      onSaved?.(data);
    } catch (e) {
      setStatus({ type: "error", message: e.message, details: e.details });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="excel-panel">
      <p className="hint">{templateHint}</p>
      <a className="directory-footer-link" href={`/templates/${templateFile}`} download>
        ⬇ Download template
      </a>

      <div className="excel-actions">
        <label className="file-drop">
          <input type="file" accept=".xlsx,.xls" onChange={handleFileChange} />
          <span className="file-drop-label">{file ? file.name : "Choose .xlsx file"}</span>
        </label>
        <button type="button" className="btn-primary" onClick={handleUpload} disabled={!file || busy}>
          {busy ? "Uploading..." : "Upload"}
        </button>
      </div>

      {status && (
        <div className={status.type === "success" ? "status-ok" : "status-err"}>
          <p>{status.message}</p>
          {status.details && (
            <ul>
              {status.details.map((d, i) => (
                <li key={i}>{d}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
