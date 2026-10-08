import { useCallback, useMemo, useState } from "react";
import TopBar from "./components/TopBar.jsx";
import PersonCard from "./components/PersonCard.jsx";
import AddModal from "./components/AddModal.jsx";
import ProfileModal from "./components/ProfileModal.jsx";
import FeeSummary from "./components/FeeSummary.jsx";
import { gradeOptions } from "./components/GradeFilter.jsx";
import { gradeLabel } from "./components/PersonCard.jsx";
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
  const [grade, setGrade] = useState("");
  const { people, loading, source, add } = usePeople(mode);

  const grades = useMemo(() => (mode === "students" ? gradeOptions(people) : []), [people, mode]);
  const inGrade = useMemo(
    () => (mode === "students" && grade ? people.filter((p) => p.class === grade) : people),
    [people, mode, grade]
  );

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return inGrade;
    return inGrade.filter((p) =>
      SEARCH_KEYS[mode].some((k) => String(p[k] ?? "").toLowerCase().includes(q))
    );
  }, [inGrade, query, mode]);

  const openIndex = visible.findIndex((p) => p.id === openId);
  const closeProfile = useCallback(() => setOpenId(null), []);

  function switchMode() {
    setMode((m) => (m === "students" ? "employees" : "students"));
    setQuery("");
    setGrade("");
    setOpenId(null);
  }

  return (
    <div className="page">
      <TopBar
        mode={mode}
        query={query}
        onQuery={setQuery}
        grades={grades}
        grade={grade}
        onGrade={setGrade}
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
        {!loading && mode === "students" && <FeeSummary students={inGrade} scope={grade ? gradeLabel(grade) : "All grades"} />}
        {loading ? (
          <p className="empty">Loading…</p>
        ) : visible.length === 0 ? (
          <p className="empty">
            No {mode} match{query ? ` “${query}”` : ""}
            {grade ? ` in ${gradeLabel(grade)}` : ""}.
          </p>
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
