import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import * as XLSX from "xlsx";

// Set this to your deployed Flask backend URL (e.g. Render free web service),
// or http://localhost:5000 while developing locally.
const BACKEND_URL =
  import.meta.env.VITE_BACKEND_URL || "http://localhost:5000";

// Parses the workbook in the browser and checks required columns / numeric
// columns are present, before ever sending the file to the backend.
async function validateInBrowser(file, requiredColumns, numericColumns) {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });

  const errors = [];
  if (rows.length === 0) {
    return ["The file has no data rows."];
  }

  const columns = new Set(Object.keys(rows[0]));
  const missing = requiredColumns.filter((c) => !columns.has(c));
  if (missing.length > 0) {
    errors.push(`Missing columns: ${missing.join(", ")}`);
    return errors; // no point checking cell values if columns are wrong
  }

  rows.forEach((row, idx) => {
    const excelRow = idx + 2; // header is row 1
    numericColumns.forEach((col) => {
      const val = row[col];
      if (val === "" || val === undefined || val === null) {
        errors.push(`Row ${excelRow}: ${col} is required.`);
      } else if (Number.isNaN(Number(val))) {
        errors.push(`Row ${excelRow}: ${col} must be a number (got "${val}").`);
      }
    });
  });

  return errors.slice(0, 20); // avoid flooding the UI on badly-formed files
}

function useCollectionIds(collection) {
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

function IdList({ label, collection }) {
  const [ids, setIds] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch(`${BACKEND_URL}/ids/${collection}`)
      .then((res) => res.json())
      .then((data) => setIds(data.ids || []))
      .catch(() => setError("Could not load existing IDs."));
  }, [collection]);

  return (
    <details className="id-list">
      <summary>{label}</summary>
      {error && <p className="status-err">{error}</p>}
      {!error && ids === null && <p className="hint">Loading...</p>}
      {!error && ids !== null && ids.length === 0 && (
        <p className="hint">None yet.</p>
      )}
      {!error && ids && ids.length > 0 && (
        <p className="id-list-values">{ids.join(", ")}</p>
      )}
    </details>
  );
}

const CARD_ICONS = {
  schools: (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M3 21V9l9-5 9 5v12" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M9 21v-6h6v6" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  ),
  drivers: (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="12" cy="8" r="3.5" stroke="currentColor" strokeWidth="1.8" />
      <path d="M4.5 20c1.6-3.6 4.4-5.5 7.5-5.5s5.9 1.9 7.5 5.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  ),
  buses: (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="3" y="5" width="18" height="12" rx="2.2" stroke="currentColor" strokeWidth="1.8" />
      <path d="M3 12h18" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="7.5" cy="19" r="1.4" fill="currentColor" />
      <circle cx="16.5" cy="19" r="1.4" fill="currentColor" />
    </svg>
  ),
  routes: (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="6" cy="6" r="2.2" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="18" cy="18" r="2.2" stroke="currentColor" strokeWidth="1.8" />
      <path d="M7.8 7.5C10 10 8 14 12 15c3 .8 3.5 1.8 4.2 2.6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeDasharray="1 3.2" />
    </svg>
  ),
  students: (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 3 2 8l10 5 10-5-10-5Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M6 10.5V16c0 1.5 2.7 3 6 3s6-1.5 6-3v-5.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  ),
  exams: (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="5" y="4" width="14" height="17" rx="1.8" stroke="currentColor" strokeWidth="1.8" />
      <path d="M9 3.5h6v2H9z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M8 10.5h8M8 14h8M8 17.5h5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  ),
  attendance: (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="3.5" y="4.5" width="17" height="16" rx="2" stroke="currentColor" strokeWidth="1.8" />
      <path d="M3.5 9h17M8 3v3M16 3v3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M8 14l2.3 2.3L16 11" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  timetable: (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="3.5" y="4.5" width="17" height="16" rx="2" stroke="currentColor" strokeWidth="1.8" />
      <path d="M3.5 9.5h17M9 4.5v16" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  ),
  results: (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M4 20V10M10 20V4M16 20v-7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M3 20h18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  ),
  admissions: (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="10" cy="8" r="3.2" stroke="currentColor" strokeWidth="1.8" />
      <path d="M4 20c1.3-3.6 3.5-5.5 6-5.5s4.7 1.9 6 5.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M18 8v5M15.5 10.5h5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  ),
  employees: (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="3.5" y="8" width="17" height="12" rx="1.8" stroke="currentColor" strokeWidth="1.8" />
      <path d="M8.5 8V6a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v2" stroke="currentColor" strokeWidth="1.8" />
      <path d="M3.5 13.5h17" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  ),
  staffAttendance: (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.8" />
      <path d="M8.5 12.3l2.3 2.3L15.8 9.2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  leaves: (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="3.5" y="4.5" width="17" height="16" rx="2" stroke="currentColor" strokeWidth="1.8" />
      <path d="M3.5 9h17M8 3v3M16 3v3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M9 13l6 5M15 13l-6 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  ),
  feeStructure: (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="4.5" y="3.5" width="15" height="17" rx="1.8" stroke="currentColor" strokeWidth="1.8" />
      <path d="M8 8h8M8 12h8M8 16h5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  ),
  feePayments: (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.8" />
      <path d="M9.3 15.2c.5.8 1.4 1.3 2.6 1.3 1.7 0 2.9-.9 2.9-2.1 0-3-5.6-1.5-5.6-4.4 0-1.2 1.2-2.1 2.9-2.1 1.1 0 2 .5 2.5 1.2M12 6.8v1.2M12 16v1.2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  ),
  visitors: (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="4" y="3.5" width="16" height="17" rx="1.8" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="12" cy="9.5" r="2.5" stroke="currentColor" strokeWidth="1.7" />
      <path d="M8 16.5c.7-2 2-3 4-3s3.3 1 4 3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  ),
  enquiries: (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M4 5.5h16v10.5H9l-4 3.5v-3.5H4Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M8 9.5h8M8 12.5h5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  ),
  gatePasses: (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M3.5 9a2.2 2.2 0 0 0 0 4v3.5a1 1 0 0 0 1 1h15a1 1 0 0 0 1-1V13a2.2 2.2 0 0 1 0-4V6.5a1 1 0 0 0-1-1h-15a1 1 0 0 0-1 1V9Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M14.5 5.5v13" stroke="currentColor" strokeWidth="1.6" strokeDasharray="1.6 2.2" />
    </svg>
  ),
};

// Generic one-record-at-a-time form, driven by a small field config. Used as
// the default ("Add manually") mode for schools/drivers/buses so a single
// person can be added without ever touching Excel.
function EntityForm({ endpoint, fields, selectOptions = {} }) {
  const initial = useMemo(
    () => Object.fromEntries(fields.map((f) => [f.name, ""])),
    [fields]
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
              {(selectOptions[f.name] || []).map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
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

function ExcelPanel({
  endpoint,
  templateHint,
  templateFile,
  requiredColumns,
  numericColumns,
  idRefs,
}) {
  const [file, setFile] = useState(null);
  const [clientErrors, setClientErrors] = useState([]);
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);

  async function handleFileChange(e) {
    const f = e.target.files[0];
    setFile(f);
    setStatus(null);
    setClientErrors([]);
    if (!f) return;
    setChecking(true);
    try {
      const errors = await validateInBrowser(f, requiredColumns, numericColumns);
      setClientErrors(errors);
    } catch {
      setClientErrors(["Could not read this file. Is it a valid .xlsx file?"]);
    } finally {
      setChecking(false);
    }
  }

  async function handleUpload() {
    if (!file || clientErrors.length > 0) return;
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
    } catch (e) {
      setStatus({ type: "error", message: e.message, details: e.details });
    } finally {
      setBusy(false);
    }
  }

  const fileLabel = file ? file.name : "Choose .xlsx file";

  return (
    <div className="excel-panel">
      <p className="hint">{templateHint}</p>
      <a className="template-link" href={`/templates/${templateFile}`} download>
        ⬇ Download template
      </a>

      {idRefs && idRefs.map((ref) => (
        <IdList key={ref.collection} label={ref.label} collection={ref.collection} />
      ))}

      <div className="upload-card-actions">
        <label className="file-drop">
          <input type="file" accept=".xlsx,.xls" onChange={handleFileChange} />
          <span className="file-drop-label">{fileLabel}</span>
        </label>
        <button
          onClick={handleUpload}
          disabled={!file || busy || checking || clientErrors.length > 0}
        >
          {busy ? "Uploading..." : checking ? "Checking file..." : "Upload"}
        </button>
      </div>

      {clientErrors.length > 0 && (
        <div className="status-err">
          <p>Fix these before uploading:</p>
          <ul>
            {clientErrors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </div>
      )}

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

// Shows every existing record for a collection (with a Delete button per
// row), so uploaded/added data doesn't just disappear into a black box.
// `action` optionally adds a second per-row button (e.g. "Convert to
// Student" on Admissions) that POSTs to a per-item endpoint and reloads.
function ManagePanel({ collection, columns, emptyLabel, action }) {
  const [items, setItems] = useState(null);
  const [error, setError] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [actingId, setActingId] = useState(null);

  const load = useCallback(() => {
    setError(null);
    fetch(`${BACKEND_URL}/records/${collection}`)
      .then((res) => res.json())
      .then((data) => setItems(data.items || []))
      .catch(() => setError("Could not load existing records."));
  }, [collection]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleDelete(id) {
    if (!window.confirm(`Delete "${id}"? This cannot be undone.`)) return;
    setDeletingId(id);
    try {
      const res = await fetch(
        `${BACKEND_URL}/records/${collection}/${encodeURIComponent(id)}`,
        { method: "DELETE" }
      );
      if (!res.ok) throw new Error("Delete failed");
      setItems((prev) => prev.filter((it) => it.id !== id));
    } catch {
      setError("Could not delete that record. Try again.");
    } finally {
      setDeletingId(null);
    }
  }

  async function handleAction(item) {
    setActingId(item.id);
    try {
      const res = await fetch(`${BACKEND_URL}${action.endpoint(item)}`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Action failed");
      load();
    } catch {
      setError("Could not complete that action. Try again.");
    } finally {
      setActingId(null);
    }
  }

  if (error) return <p className="status-err">{error}</p>;
  if (items === null) return <p className="hint">Loading...</p>;
  if (items.length === 0) {
    return <p className="hint">{emptyLabel || "None yet."}</p>;
  }

  return (
    <div className="manage-panel">
      <table className="manage-table">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key}>{c.label}</th>
            ))}
            <th />
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id}>
              {columns.map((c) => (
                <td key={c.key}>{c.format ? c.format(item) : item[c.key] ?? ""}</td>
              ))}
              <td className="manage-row-actions">
                {action && (
                  <button
                    type="button"
                    className="manage-action"
                    onClick={() => handleAction(item)}
                    disabled={
                      actingId === item.id ||
                      (action.disabled ? action.disabled(item) : false)
                    }
                  >
                    {actingId === item.id ? "..." : action.label}
                  </button>
                )}
                <button
                  type="button"
                  className="manage-delete"
                  onClick={() => handleDelete(item.id)}
                  disabled={deletingId === item.id}
                >
                  {deletingId === item.id ? "..." : "Delete"}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function UploadCard({
  step,
  icon,
  title,
  description,
  excel,
  formFields,
  formEndpoint,
  selectOptions,
  manualPanel,
  manage,
}) {
  const [mode, setMode] = useState("form");

  return (
    <div className="upload-card">
      <div className="upload-card-head">
        <span className="upload-card-icon">{icon}</span>
        <div>
          <span className="upload-card-step">Step {step}</span>
          <h3>{title}</h3>
        </div>
      </div>

      <p className="upload-card-desc">{description}</p>

      <div className="upload-card-tabs">
        <button
          type="button"
          className={mode === "form" ? "active" : ""}
          onClick={() => setMode("form")}
        >
          Add manually
        </button>
        <button
          type="button"
          className={mode === "excel" ? "active" : ""}
          onClick={() => setMode("excel")}
        >
          Excel upload
        </button>
        <button
          type="button"
          className={mode === "manage" ? "active" : ""}
          onClick={() => setMode("manage")}
        >
          Existing data
        </button>
      </div>

      {mode === "form" && (
        manualPanel || (
          <EntityForm
            endpoint={formEndpoint}
            fields={formFields}
            selectOptions={selectOptions}
          />
        )
      )}
      {mode === "excel" && <ExcelPanel {...excel} />}
      {mode === "manage" && <ManagePanel {...manage} />}
    </div>
  );
}

export default function UploadPage() {
  const driverIds = useCollectionIds("drivers");
  const schoolIds = useCollectionIds("schools");
  const employeeIds = useCollectionIds("employees");
  const studentIds = useCollectionIds("students");
  const { tab } = useParams();
  const [active, setActive] = useState(tab || "schools");

  useEffect(() => {
    if (tab) setActive(tab);
  }, [tab]);

  const cards = [
    {
      key: "schools",
      step: 1,
      icon: CARD_ICONS.schools,
      title: "Schools",
      description: "Add a school location, or bulk-upload a list.",
      formEndpoint: "/schools/add",
      formFields: [
        { name: "name", label: "Name", required: true, placeholder: "Green Valley School" },
        { name: "lat", label: "Latitude", type: "number", required: true, placeholder: "28.4595" },
        { name: "lng", label: "Longitude", type: "number", required: true, placeholder: "77.0266" },
      ],
      excel: {
        endpoint: "/upload/schools",
        templateHint: "Columns: name, lat, lng (IDs are assigned automatically)",
        templateFile: "schools_template.xlsx",
        requiredColumns: ["name", "lat", "lng"],
        numericColumns: ["lat", "lng"],
      },
      manage: {
        collection: "schools",
        emptyLabel: "No schools added yet.",
        columns: [
          { key: "id", label: "ID" },
          { key: "name", label: "Name" },
          { key: "lat", label: "Latitude" },
          { key: "lng", label: "Longitude" },
        ],
      },
    },
    {
      key: "drivers",
      step: 2,
      icon: CARD_ICONS.drivers,
      title: "Drivers",
      description: "Add a driver, or bulk-upload a list.",
      formEndpoint: "/drivers/add",
      formFields: [
        { name: "name", label: "Name", required: true, placeholder: "Ramesh Kumar" },
        { name: "phone", label: "Phone", placeholder: "9876543210" },
      ],
      excel: {
        endpoint: "/upload/drivers",
        templateHint: "Columns: name, phone (IDs are assigned automatically)",
        templateFile: "drivers_template.xlsx",
        requiredColumns: ["name"],
        numericColumns: [],
      },
      manage: {
        collection: "drivers",
        emptyLabel: "No drivers added yet.",
        columns: [
          { key: "id", label: "ID" },
          { key: "name", label: "Name" },
          { key: "phone", label: "Phone" },
        ],
      },
    },
    {
      key: "buses",
      step: 3,
      icon: CARD_ICONS.buses,
      title: "Buses",
      description: "Add a bus and link it to a driver, or bulk-upload a list.",
      formEndpoint: "/buses/add",
      formFields: [
        { name: "bus_number", label: "Bus Number", required: true, placeholder: "HR-26-AB-1234" },
        { name: "driver_id", label: "Driver", type: "select" },
        { name: "capacity", label: "Capacity", type: "number", placeholder: "40" },
      ],
      selectOptions: { driver_id: driverIds },
      excel: {
        endpoint: "/upload/buses",
        templateHint:
          "Columns: bus_number, driver_id, capacity (bus_id is assigned automatically)",
        templateFile: "buses_template.xlsx",
        requiredColumns: ["bus_number"],
        numericColumns: [],
        idRefs: [
          { label: "Existing driver IDs (for driver_id column)", collection: "drivers" },
        ],
      },
      manage: {
        collection: "buses",
        emptyLabel: "No buses added yet.",
        columns: [
          { key: "id", label: "ID" },
          { key: "busNumber", label: "Bus Number" },
          { key: "driverId", label: "Driver" },
          { key: "capacity", label: "Capacity" },
        ],
      },
    },
    {
      key: "routes",
      step: 4,
      icon: CARD_ICONS.routes,
      title: "Routes & Stops",
      description: "Add one route at a time by dropping pins on a map, or bulk-upload stops.",
      manualPanel: (
        <div className="manual-route-panel">
          <p className="hint">
            Routes are built visually — pick a school and bus, then click
            the map to drop stops in order.
          </p>
          <Link to="/add-route" className="btn-link">
            Open Add Route →
          </Link>
        </div>
      ),
      excel: {
        endpoint: "/upload/routes",
        templateHint:
          "Columns: route_id, school_id, bus_id, stop_order, stop_name, lat, lng, students_count",
        templateFile: "routes_template.xlsx",
        requiredColumns: [
          "route_id",
          "school_id",
          "bus_id",
          "stop_order",
          "stop_name",
          "lat",
          "lng",
          "students_count",
        ],
        numericColumns: ["stop_order", "lat", "lng", "students_count"],
        idRefs: [
          { label: "Existing school IDs (for school_id column)", collection: "schools" },
          { label: "Existing bus IDs (for bus_id column)", collection: "buses" },
        ],
      },
      manage: {
        collection: "routes",
        emptyLabel: "No routes added yet.",
        columns: [
          { key: "id", label: "Doc ID" },
          { key: "routeId", label: "Route" },
          { key: "schoolId", label: "School" },
          { key: "busId", label: "Bus" },
          { key: "stops", label: "Stops", format: (item) => (item.stops || []).length },
        ],
      },
    },
    {
      key: "students",
      step: 5,
      icon: CARD_ICONS.students,
      title: "Students",
      description: "Add a student and their class, or bulk-upload a list.",
      formEndpoint: "/students/add",
      formFields: [
        { name: "name", label: "Name", required: true, placeholder: "Aarav Sharma" },
        { name: "school_id", label: "School", type: "select", required: true },
        { name: "class", label: "Class", required: true, placeholder: "10" },
        { name: "section", label: "Section", required: true, placeholder: "A" },
        { name: "roll_no", label: "Roll No.", placeholder: "12" },
        { name: "admission_no", label: "Admission No.", placeholder: "AD-2026-001" },
        { name: "parent_name", label: "Parent Name", placeholder: "Rakesh Sharma" },
        { name: "parent_phone", label: "Parent Phone", placeholder: "9876500001" },
      ],
      selectOptions: { school_id: schoolIds },
      excel: {
        endpoint: "/upload/students",
        templateHint:
          "Columns: name, school_id, class, section, roll_no, admission_no, parent_name, parent_phone (student_id is assigned automatically)",
        templateFile: "students_template.xlsx",
        requiredColumns: ["name", "school_id", "class", "section"],
        numericColumns: [],
        idRefs: [
          { label: "Existing school IDs (for school_id column)", collection: "schools" },
        ],
      },
      manage: {
        collection: "students",
        emptyLabel: "No students added yet.",
        columns: [
          { key: "id", label: "ID" },
          { key: "name", label: "Name" },
          { key: "schoolId", label: "School" },
          { key: "class", label: "Class" },
          { key: "section", label: "Section" },
          { key: "rollNo", label: "Roll No." },
          { key: "admissionNo", label: "Admission No." },
          { key: "admissionId", label: "Admission ID" },
        ],
      },
    },
    {
      key: "exams",
      step: 6,
      icon: CARD_ICONS.exams,
      title: "Exams",
      description: "Create an exam for a class, or bulk-upload a list.",
      formEndpoint: "/exams/add",
      formFields: [
        { name: "name", label: "Exam Name", required: true, placeholder: "Term 1" },
        { name: "school_id", label: "School", type: "select", required: true },
        { name: "class", label: "Class", required: true, placeholder: "10" },
        { name: "section", label: "Section", required: true, placeholder: "A" },
        { name: "date", label: "Date", required: true, placeholder: "2026-09-15" },
      ],
      selectOptions: { school_id: schoolIds },
      excel: {
        endpoint: "/upload/exams",
        templateHint:
          "Columns: name, school_id, class, section, date (exam_id is assigned automatically)",
        templateFile: "exams_template.xlsx",
        requiredColumns: ["name", "school_id", "class", "section", "date"],
        numericColumns: [],
        idRefs: [
          { label: "Existing school IDs (for school_id column)", collection: "schools" },
        ],
      },
      manage: {
        collection: "exams",
        emptyLabel: "No exams added yet.",
        columns: [
          { key: "id", label: "ID" },
          { key: "name", label: "Name" },
          { key: "schoolId", label: "School" },
          { key: "class", label: "Class" },
          { key: "section", label: "Section" },
          { key: "date", label: "Date" },
        ],
      },
    },
    {
      key: "attendance",
      step: 7,
      icon: CARD_ICONS.attendance,
      title: "Attendance",
      description: "Mark a class's daily attendance, or bulk-upload records.",
      manualPanel: (
        <div className="manual-route-panel">
          <p className="hint">
            Attendance is marked per class per day — pick a school, class,
            section and date, then check off each student.
          </p>
          <Link to="/attendance/mark" className="btn-link">
            Open Mark Attendance →
          </Link>
        </div>
      ),
      excel: {
        endpoint: "/upload/attendance",
        templateHint:
          "Columns: date, school_id, class, section, student_id, status (Present/Absent)",
        templateFile: "attendance_template.xlsx",
        requiredColumns: ["date", "school_id", "class", "section", "student_id", "status"],
        numericColumns: [],
        idRefs: [
          { label: "Existing school IDs (for school_id column)", collection: "schools" },
          { label: "Existing student IDs (for student_id column)", collection: "students" },
        ],
      },
      manage: {
        collection: "attendance",
        emptyLabel: "No attendance marked yet.",
        columns: [
          { key: "id", label: "Doc ID" },
          { key: "schoolId", label: "School" },
          { key: "class", label: "Class" },
          { key: "section", label: "Section" },
          { key: "date", label: "Date" },
          {
            key: "records",
            label: "Present / Total",
            format: (item) => {
              const records = item.records || [];
              const present = records.filter((r) => r.status === "Present").length;
              return `${present} / ${records.length}`;
            },
          },
        ],
      },
    },
    {
      key: "timetable",
      step: 8,
      icon: CARD_ICONS.timetable,
      title: "Timetable",
      description: "Build a class's weekly period schedule, or bulk-upload it.",
      manualPanel: (
        <div className="manual-route-panel">
          <p className="hint">
            Pick a school, class and section, then add each period in order.
          </p>
          <Link to="/timetable/build" className="btn-link">
            Open Build Timetable →
          </Link>
        </div>
      ),
      excel: {
        endpoint: "/upload/timetable",
        templateHint:
          "Columns: school_id, class, section, day, period_no, subject, teacher, start_time, end_time",
        templateFile: "timetable_template.xlsx",
        requiredColumns: [
          "school_id",
          "class",
          "section",
          "day",
          "period_no",
          "subject",
          "teacher",
          "start_time",
          "end_time",
        ],
        numericColumns: ["period_no"],
        idRefs: [
          { label: "Existing school IDs (for school_id column)", collection: "schools" },
        ],
      },
      manage: {
        collection: "timetable",
        emptyLabel: "No timetables built yet.",
        columns: [
          { key: "id", label: "Doc ID" },
          { key: "schoolId", label: "School" },
          { key: "class", label: "Class" },
          { key: "section", label: "Section" },
          { key: "periods", label: "Periods", format: (item) => (item.periods || []).length },
        ],
      },
    },
    {
      key: "results",
      step: 9,
      icon: CARD_ICONS.results,
      title: "Exam Results",
      description: "Enter marks for an exam, or bulk-upload results.",
      manualPanel: (
        <div className="manual-route-panel">
          <p className="hint">
            Create the exam first (left tab), then pick it here to enter
            every student's marks.
          </p>
          <Link to="/exams/marks-entry" className="btn-link">
            Open Marks Entry →
          </Link>
        </div>
      ),
      excel: {
        endpoint: "/upload/results",
        templateHint:
          "Columns: exam_id, school_id, class, section, student_id, subject, marks_obtained, max_marks",
        templateFile: "results_template.xlsx",
        requiredColumns: [
          "exam_id",
          "school_id",
          "class",
          "section",
          "student_id",
          "subject",
          "marks_obtained",
          "max_marks",
        ],
        numericColumns: ["marks_obtained", "max_marks"],
        idRefs: [
          { label: "Existing exam IDs (for exam_id column)", collection: "exams" },
          { label: "Existing student IDs (for student_id column)", collection: "students" },
        ],
      },
      manage: {
        collection: "results",
        emptyLabel: "No results entered yet.",
        columns: [
          { key: "id", label: "Exam ID" },
          { key: "schoolId", label: "School" },
          { key: "class", label: "Class" },
          { key: "section", label: "Section" },
          { key: "entries", label: "Entries", format: (item) => (item.entries || []).length },
        ],
      },
    },
    {
      key: "admissions",
      step: 10,
      icon: CARD_ICONS.admissions,
      title: "Admissions",
      description: "Log an admission enquiry, or bulk-upload a list. Approve and convert to a student when ready.",
      formEndpoint: "/admissions/add",
      formFields: [
        { name: "name", label: "Applicant Name", required: true, placeholder: "Priya Verma" },
        { name: "school_id", label: "School", type: "select", required: true },
        { name: "class", label: "Class", required: true, placeholder: "9" },
        { name: "section", label: "Section", required: true, placeholder: "B" },
        { name: "admission_no", label: "Admission No.", placeholder: "AD-2026-002" },
        { name: "parent_name", label: "Parent Name", placeholder: "Suresh Verma" },
        { name: "parent_phone", label: "Parent Phone", placeholder: "9876500002" },
        { name: "status", label: "Status", type: "select", placeholder: "Enquiry" },
      ],
      selectOptions: {
        school_id: schoolIds,
        status: ["Enquiry", "Approved", "Rejected"],
      },
      excel: {
        endpoint: "/upload/admissions",
        templateHint:
          "Columns: name, school_id, class, section, admission_no, parent_name, parent_phone, status",
        templateFile: "admissions_template.xlsx",
        requiredColumns: ["name", "school_id", "class", "section"],
        numericColumns: [],
        idRefs: [
          { label: "Existing school IDs (for school_id column)", collection: "schools" },
        ],
      },
      manage: {
        collection: "admissions",
        emptyLabel: "No admissions yet.",
        columns: [
          { key: "id", label: "ID" },
          { key: "name", label: "Name" },
          { key: "class", label: "Class" },
          { key: "section", label: "Section" },
          { key: "admissionNo", label: "Admission No." },
          { key: "status", label: "Status" },
        ],
        action: {
          label: "Convert to Student",
          endpoint: (item) => `/admissions/${item.id}/convert`,
          disabled: (item) => item.status === "Admitted",
        },
      },
    },
    {
      key: "employees",
      step: 11,
      icon: CARD_ICONS.employees,
      title: "Employees",
      description: "Add a staff member, or bulk-upload a list.",
      formEndpoint: "/employees/add",
      formFields: [
        { name: "name", label: "Name", required: true, placeholder: "Meena Gupta" },
        { name: "school_id", label: "School", type: "select", required: true },
        { name: "designation", label: "Designation", placeholder: "Teacher" },
        { name: "department", label: "Department", placeholder: "Mathematics" },
        { name: "phone", label: "Phone", placeholder: "9876500003" },
        { name: "email", label: "Email", placeholder: "meena@example.com" },
        { name: "joining_date", label: "Joining Date", placeholder: "2020-06-01" },
      ],
      selectOptions: { school_id: schoolIds },
      excel: {
        endpoint: "/upload/employees",
        templateHint:
          "Columns: name, school_id, designation, department, phone, email, joining_date (employee_id is assigned automatically)",
        templateFile: "employees_template.xlsx",
        requiredColumns: ["name", "school_id"],
        numericColumns: [],
        idRefs: [
          { label: "Existing school IDs (for school_id column)", collection: "schools" },
        ],
      },
      manage: {
        collection: "employees",
        emptyLabel: "No employees added yet.",
        columns: [
          { key: "id", label: "ID" },
          { key: "name", label: "Name" },
          { key: "designation", label: "Designation" },
          { key: "department", label: "Department" },
          { key: "phone", label: "Phone" },
        ],
      },
    },
    {
      key: "staffAttendance",
      step: 12,
      icon: CARD_ICONS.staffAttendance,
      title: "Staff Attendance",
      description: "Mark daily attendance for staff, or bulk-upload records.",
      manualPanel: (
        <div className="manual-route-panel">
          <p className="hint">
            Staff attendance is marked per school per day — pick a school
            and date, then check off each employee.
          </p>
          <Link to="/employees/attendance" className="btn-link">
            Open Mark Staff Attendance →
          </Link>
        </div>
      ),
      excel: {
        endpoint: "/upload/staff-attendance",
        templateHint: "Columns: date, school_id, employee_id, status (Present/Absent)",
        templateFile: "staff_attendance_template.xlsx",
        requiredColumns: ["date", "school_id", "employee_id", "status"],
        numericColumns: [],
        idRefs: [
          { label: "Existing school IDs (for school_id column)", collection: "schools" },
          { label: "Existing employee IDs (for employee_id column)", collection: "employees" },
        ],
      },
      manage: {
        collection: "staffAttendance",
        emptyLabel: "No staff attendance marked yet.",
        columns: [
          { key: "id", label: "Doc ID" },
          { key: "schoolId", label: "School" },
          { key: "date", label: "Date" },
          {
            key: "records",
            label: "Present / Total",
            format: (item) => {
              const records = item.records || [];
              const present = records.filter((r) => r.status === "Present").length;
              return `${present} / ${records.length}`;
            },
          },
        ],
      },
    },
    {
      key: "leaves",
      step: 13,
      icon: CARD_ICONS.leaves,
      title: "Leaves",
      description: "Log a staff leave request, or bulk-upload a list.",
      formEndpoint: "/leaves/add",
      formFields: [
        { name: "employee_id", label: "Employee", type: "select", required: true },
        { name: "from_date", label: "From Date", required: true, placeholder: "2026-08-20" },
        { name: "to_date", label: "To Date", required: true, placeholder: "2026-08-22" },
        { name: "reason", label: "Reason", placeholder: "Family function" },
        { name: "status", label: "Status", type: "select", placeholder: "Pending" },
      ],
      selectOptions: {
        employee_id: employeeIds,
        status: ["Pending", "Approved", "Rejected"],
      },
      excel: {
        endpoint: "/upload/leaves",
        templateHint: "Columns: employee_id, from_date, to_date, reason, status",
        templateFile: "leaves_template.xlsx",
        requiredColumns: ["employee_id", "from_date", "to_date"],
        numericColumns: [],
        idRefs: [
          { label: "Existing employee IDs (for employee_id column)", collection: "employees" },
        ],
      },
      manage: {
        collection: "leaves",
        emptyLabel: "No leave requests yet.",
        columns: [
          { key: "id", label: "ID" },
          { key: "employeeId", label: "Employee" },
          { key: "fromDate", label: "From" },
          { key: "toDate", label: "To" },
          { key: "status", label: "Status" },
        ],
      },
    },
    {
      key: "feeStructure",
      step: 14,
      icon: CARD_ICONS.feeStructure,
      title: "Fee Structure",
      description: "Define a class's fee amount, or bulk-upload a list.",
      formEndpoint: "/fee-structure/add",
      formFields: [
        { name: "school_id", label: "School", type: "select", required: true },
        { name: "class", label: "Class", required: true, placeholder: "10" },
        { name: "fee_type", label: "Fee Type", required: true, placeholder: "Tuition" },
        { name: "amount", label: "Amount", type: "number", required: true, placeholder: "5000" },
      ],
      selectOptions: { school_id: schoolIds },
      excel: {
        endpoint: "/upload/fee-structure",
        templateHint: "Columns: school_id, class, fee_type, amount",
        templateFile: "fee_structure_template.xlsx",
        requiredColumns: ["school_id", "class", "fee_type", "amount"],
        numericColumns: ["amount"],
        idRefs: [
          { label: "Existing school IDs (for school_id column)", collection: "schools" },
        ],
      },
      manage: {
        collection: "feeStructure",
        emptyLabel: "No fee structure defined yet.",
        columns: [
          { key: "id", label: "ID" },
          { key: "class", label: "Class" },
          { key: "feeType", label: "Fee Type" },
          { key: "amount", label: "Amount" },
        ],
      },
    },
    {
      key: "feePayments",
      step: 15,
      icon: CARD_ICONS.feePayments,
      title: "Fee Payments",
      description: "Record a fee payment, or bulk-upload a list.",
      formEndpoint: "/fee-payments/add",
      formFields: [
        { name: "student_id", label: "Student", type: "select", required: true },
        { name: "amount_paid", label: "Amount Paid", type: "number", required: true, placeholder: "5000" },
        { name: "payment_date", label: "Payment Date", required: true, placeholder: "2026-08-01" },
        { name: "mode", label: "Mode", type: "select", placeholder: "Online" },
        { name: "remarks", label: "Remarks", placeholder: "Term 1 fee" },
      ],
      selectOptions: {
        student_id: studentIds,
        mode: ["Cash", "Online", "Cheque"],
      },
      excel: {
        endpoint: "/upload/fee-payments",
        templateHint: "Columns: student_id, amount_paid, payment_date, mode, remarks",
        templateFile: "fee_payments_template.xlsx",
        requiredColumns: ["student_id", "amount_paid", "payment_date"],
        numericColumns: ["amount_paid"],
        idRefs: [
          { label: "Existing student IDs (for student_id column)", collection: "students" },
        ],
      },
      manage: {
        collection: "feePayments",
        emptyLabel: "No fee payments recorded yet.",
        columns: [
          { key: "id", label: "ID" },
          { key: "studentId", label: "Student" },
          { key: "amountPaid", label: "Amount" },
          { key: "paymentDate", label: "Date" },
          { key: "mode", label: "Mode" },
        ],
      },
    },
    {
      key: "visitors",
      step: 16,
      icon: CARD_ICONS.visitors,
      title: "Visitors",
      description: "Log a visitor, or bulk-upload a list.",
      formEndpoint: "/visitors/add",
      formFields: [
        { name: "name", label: "Name", required: true, placeholder: "Ramesh Kumar" },
        { name: "phone", label: "Phone", placeholder: "9876500004" },
        { name: "purpose", label: "Purpose", required: true, placeholder: "Admission enquiry" },
        { name: "meet_whom", label: "Meeting", placeholder: "Principal" },
        { name: "date", label: "Date", required: true, placeholder: "2026-08-12" },
        { name: "in_time", label: "In Time", placeholder: "10:00" },
        { name: "out_time", label: "Out Time", placeholder: "10:30" },
      ],
      excel: {
        endpoint: "/upload/visitors",
        templateHint: "Columns: name, phone, purpose, meet_whom, date, in_time, out_time",
        templateFile: "visitors_template.xlsx",
        requiredColumns: ["name", "purpose", "date"],
        numericColumns: [],
      },
      manage: {
        collection: "visitors",
        emptyLabel: "No visitors logged yet.",
        columns: [
          { key: "id", label: "ID" },
          { key: "name", label: "Name" },
          { key: "purpose", label: "Purpose" },
          { key: "date", label: "Date" },
          { key: "meetWhom", label: "Meeting" },
        ],
      },
    },
    {
      key: "enquiries",
      step: 17,
      icon: CARD_ICONS.enquiries,
      title: "Enquiries",
      description: "Log a front-desk enquiry, or bulk-upload a list.",
      formEndpoint: "/enquiries/add",
      formFields: [
        { name: "name", label: "Name", required: true, placeholder: "Sunita Devi" },
        { name: "phone", label: "Phone", placeholder: "9876500005" },
        { name: "query", label: "Query", required: true, placeholder: "Fee structure for class 6" },
        { name: "status", label: "Status", type: "select", placeholder: "New" },
      ],
      selectOptions: { status: ["New", "Contacted", "Closed"] },
      excel: {
        endpoint: "/upload/enquiries",
        templateHint: "Columns: name, phone, query, status",
        templateFile: "enquiries_template.xlsx",
        requiredColumns: ["name", "query"],
        numericColumns: [],
      },
      manage: {
        collection: "enquiries",
        emptyLabel: "No enquiries logged yet.",
        columns: [
          { key: "id", label: "ID" },
          { key: "name", label: "Name" },
          { key: "query", label: "Query" },
          { key: "status", label: "Status" },
        ],
      },
    },
    {
      key: "gatePasses",
      step: 18,
      icon: CARD_ICONS.gatePasses,
      title: "Gate Passes",
      description: "Issue a student gate pass, or bulk-upload a list.",
      formEndpoint: "/gate-passes/add",
      formFields: [
        { name: "student_id", label: "Student", type: "select", required: true },
        { name: "reason", label: "Reason", required: true, placeholder: "Doctor appointment" },
        { name: "date", label: "Date", required: true, placeholder: "2026-08-12" },
        { name: "time_out", label: "Time Out", placeholder: "12:30" },
        { name: "approved_by", label: "Approved By", placeholder: "Mrs. Sharma" },
      ],
      selectOptions: { student_id: studentIds },
      excel: {
        endpoint: "/upload/gate-passes",
        templateHint: "Columns: student_id, reason, date, time_out, approved_by",
        templateFile: "gate_passes_template.xlsx",
        requiredColumns: ["student_id", "reason", "date"],
        numericColumns: [],
        idRefs: [
          { label: "Existing student IDs (for student_id column)", collection: "students" },
        ],
      },
      manage: {
        collection: "gatePasses",
        emptyLabel: "No gate passes issued yet.",
        columns: [
          { key: "id", label: "ID" },
          { key: "studentId", label: "Student" },
          { key: "reason", label: "Reason" },
          { key: "date", label: "Date" },
          { key: "timeOut", label: "Time Out" },
        ],
      },
    },
  ];

  const activeCard = cards.find((c) => c.key === active) || cards[0];

  return (
    <div className="upload-page">
      <div className="upload-hero">
        <h1>Upload Data</h1>
        <p>
          Add schools, drivers, buses and routes one at a time with a simple
          form — or switch to Excel upload for bulk import. IDs are
          generated automatically; you never need to type or invent one.
        </p>
      </div>

      <div className="upload-layout">
        <nav className="upload-sidenav">
          {cards.map((c) => (
            <button
              key={c.key}
              type="button"
              className={c.key === active ? "active" : ""}
              onClick={() => setActive(c.key)}
            >
              <span className="upload-sidenav-icon">{c.icon}</span>
              {c.title}
            </button>
          ))}
        </nav>

        <div className="upload-content">
          <UploadCard {...activeCard} />
        </div>
      </div>
    </div>
  );
}
