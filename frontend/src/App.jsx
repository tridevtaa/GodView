import { useCallback, useMemo, useState } from "react";
import TopBar from "./components/TopBar.jsx";
import PersonCard from "./components/PersonCard.jsx";
import AddModal from "./components/AddModal.jsx";
import ProfileModal from "./components/ProfileModal.jsx";
import FeeSummary from "./components/FeeSummary.jsx";
import { usePeople } from "./data/usePeople.js";

const SEARCH_KEYS = {
  students: ["name", "parent_name", "mother_name", "admission_no", "class", "section", "parent_phone"],
  employees: ["name", "designation", "department", "employee_no"],
};

export default function App() {
  const [mode, setMode] = useState("students");
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(false);
  const [openId, setOpenId] = useState(null);
  const { people, loading, source, add } = usePeople(mode);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return people;
    return people.filter((p) =>
      SEARCH_KEYS[mode].some((k) => String(p[k] ?? "").toLowerCase().includes(q))
    );
  }, [people, query, mode]);

  const openIndex = visible.findIndex((p) => p.id === openId);
  const closeProfile = useCallback(() => setOpenId(null), []);

  function switchMode() {
    setMode((m) => (m === "students" ? "employees" : "students"));
    setQuery("");
    setOpenId(null);
  }

  return (
    <div className="page">
      <TopBar
        mode={mode}
        query={query}
        onQuery={setQuery}
        onAdd={() => setAdding(true)}
        onSwitch={switchMode}
      />

      <main className="content">
        {!loading && source !== "firestore" && (
          <p className="notice">
            {source === "local"
              ? `${people.length} ${mode} from a local file — not yet saved to Firestore.`
              : "Showing sample data — add records or upload to Firestore to see real ones."}
          </p>
        )}
        {!loading && mode === "students" && <FeeSummary students={people} />}
        {loading ? (
          <p className="empty">Loading…</p>
        ) : visible.length === 0 ? (
          <p className="empty">No {mode} match “{query}”.</p>
        ) : (
          <div className="grid">
            {visible.map((p, i) => (
              <PersonCard key={p.id} person={p} mode={mode} index={i} onOpen={() => setOpenId(p.id)} />
            ))}
          </div>
        )}
      </main>

      {openIndex !== -1 && (
        <ProfileModal
          person={visible[openIndex]}
          mode={mode}
          index={openIndex}
          onClose={closeProfile}
        />
      )}
      {adding && <AddModal mode={mode} onClose={() => setAdding(false)} onSave={add} />}
    </div>
  );
}
