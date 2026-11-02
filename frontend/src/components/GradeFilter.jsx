import { gradeLabel } from "./PersonCard.jsx";

// Nursery, KG 1, KG 2, then 1–12; anything unrecognised goes last.
export function gradeRank(klass) {
  if (/^nursery$/i.test(klass)) return -3;
  const kg = /^kg\s*(\d)$/i.exec(klass);
  if (kg) return -3 + Number(kg[1]);
  return /^\d+$/.test(klass) ? Number(klass) : 100;
}

export function gradeOptions(students) {
  const counts = new Map();
  for (const s of students) if (s.class) counts.set(s.class, (counts.get(s.class) || 0) + 1);
  return [...counts]
    .sort(([a], [b]) => gradeRank(a) - gradeRank(b) || a.localeCompare(b))
    .map(([value, count]) => ({ value, count }));
}

// The picked grades in words; none picked means all grades.
export function gradesText(value) {
  if (!value.length) return "All grades";
  if (value.length <= 2) return value.map(gradeLabel).join(", ");
  return `${value.length} grades`;
}
