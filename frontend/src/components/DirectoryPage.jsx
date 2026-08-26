import React, { useCallback, useEffect, useMemo, useState } from "react";
import { BACKEND_URL, EntityForm, ExcelPanel, FieldList } from "./entityApi.jsx";
import { SearchIcon } from "./icons.jsx";

// A focused "search, add, view details" page for a single collection —
// replaces the multi-tab Upload flow for the entities that live in the top
// nav (Students, Employees), so there's no second in-page nav to maintain.
export default function DirectoryPage({
  title,
  singularLabel,
  collection,
  addEndpoint,
  fields,
  selectOptions,
  summaryKeys,
  addPanelFooter,
  excel,
  renderDetail,
  filterField,
  filterLabel,
}) {
  const [items, setItems] = useState(null);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState("");
  const [filterValue, setFilterValue] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [addMode, setAddMode] = useState("form");
  const [selected, setSelected] = useState(null);
  const [deleting, setDeleting] = useState(false);

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

  const filterOptions = useMemo(() => {
    if (!filterField || !items) return [];
    const values = new Set(items.map((it) => it[filterField]).filter(Boolean));
    return Array.from(values).sort();
  }, [items, filterField]);

  const filtered = useMemo(() => {
    if (!items) return [];
    let list = items;
    if (filterField && filterValue) {
      list = list.filter((item) => String(item[filterField] ?? "") === filterValue);
    }
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter((item) =>
      Object.values(item).some((v) => String(v ?? "").toLowerCase().includes(q))
    );
  }, [items, query, filterField, filterValue]);

  async function handleDelete(id) {
    if (!window.confirm(`Delete "${id}"? This cannot be undone.`)) return;
    setDeleting(true);
    try {
      const res = await fetch(
        `${BACKEND_URL}/records/${collection}/${encodeURIComponent(id)}`,
        { method: "DELETE" }
      );
      if (!res.ok) throw new Error("Delete failed");
      setItems((prev) => prev.filter((it) => it.id !== id));
      setSelected(null);
    } catch {
      setError("Could not delete that record. Try again.");
    } finally {
      setDeleting(false);
    }
  }

  function handleSaved() {
    load();
    setShowAdd(false);
    setAddMode("form");
  }

  return (
    <div className="directory-page">
      <div className="directory-header">
        <div>
          <h1>{title}</h1>
          <p>Search existing records or add a new one.</p>
        </div>
        <button
          type="button"
          className="btn-primary"
          onClick={() => setShowAdd((v) => !v)}
        >
          {showAdd ? "Cancel" : `+ Add ${singularLabel}`}
        </button>
      </div>

      {showAdd && (
        <div className="directory-add-panel">
          {excel && (
            <div className="excel-tabs">
              <button
                type="button"
                className={addMode === "form" ? "active" : ""}
                onClick={() => setAddMode("form")}
              >
                Add manually
              </button>
              <button
                type="button"
                className={addMode === "excel" ? "active" : ""}
                onClick={() => setAddMode("excel")}
              >
                Excel upload
              </button>
            </div>
          )}

          {addMode === "form" ? (
            <EntityForm
              endpoint={addEndpoint}
              fields={fields}
              selectOptions={selectOptions}
              initialValues={filterField && filterValue ? { [filterField]: filterValue } : {}}
              onSaved={handleSaved}
            />
          ) : (
            <ExcelPanel {...excel} onSaved={handleSaved} />
          )}

          {addPanelFooter}
        </div>
      )}

      <div className="directory-filters">
        <label className="directory-search">
          <SearchIcon />
          <input
            type="text"
            placeholder={`Search ${title.toLowerCase()}...`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        {filterField && (
          <select
            className="directory-filter-select"
            value={filterValue}
            onChange={(e) => setFilterValue(e.target.value)}
          >
            <option value="">All {filterLabel || filterField}</option>
            {filterOptions.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        )}
      </div>

      {error && <p className="status-err">{error}</p>}
      {items === null && !error && <p className="hint">Loading...</p>}
      {items !== null && filtered.length === 0 && (
        <p className="hint">No matching records.</p>
      )}

      <div className="directory-list">
        {filtered.map((item) => (
          <button
            key={item.id}
            type="button"
            className="directory-row"
            onClick={() => setSelected(item)}
          >
            <span className="directory-row-name">{item.name || item.id}</span>
            <span className="directory-row-meta">
              {(summaryKeys || [])
                .map((k) => item[k])
                .filter(Boolean)
                .join(" · ")}
            </span>
          </button>
        ))}
      </div>

      {selected && (
        <div className="directory-overlay" onClick={() => setSelected(null)}>
          <div
            className={renderDetail ? "directory-detail directory-detail-wide" : "directory-detail"}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className="directory-detail-close"
              onClick={() => setSelected(null)}
            >
              ×
            </button>
            <h2>{selected.name || selected.id}</h2>
            {renderDetail ? (
              renderDetail(selected, { refresh: load, close: () => setSelected(null) })
            ) : (
              <FieldList item={selected} exclude={["name"]} />
            )}
            <button
              type="button"
              className="manage-delete"
              onClick={() => handleDelete(selected.id)}
              disabled={deleting}
            >
              {deleting ? "Deleting..." : "Delete"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
