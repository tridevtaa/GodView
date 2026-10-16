// Turns a teacher's own marks sheet (any export with a Roll No and/or Name
// column, plus one column of scores) into the { id -> value } map MarksPage
// already uses. Pure function, no Supabase import, so it's easy to test.

const text = (v) => (v === null || v === undefined ? "" : String(v).trim());
const norm = (v) => text(v).toLowerCase();

function findCol(headers, patterns) {
  return headers.find((h) => patterns.some((p) => p.test(norm(h)))) ?? null;
}

// The one column that holds scores: an explicit "Marks"-ish header if there
// is one, else whichever single column is left once roll/name/id columns
// are ruled out (teachers often just name it after the exam, e.g. "SA1").
function marksColumn(headers, rollCol, nameCol) {
  const explicit = findCol(headers, [/^marks?$/, /score/, /obtained/]);
  if (explicit) return explicit;
  const rest = headers.filter(
    (h) => h !== rollCol && h !== nameCol && !/^(mis|admission|reg(istration)?\s*no\.?)$/.test(norm(h))
  );
  return rest.length === 1 ? rest[0] : null;
}

// rows: sheet_to_json rows (header -> cell). kids: the class roster already
// loaded (needs id, name, roll_no). max: the test's max marks, for flagging
// out-of-range values so the teacher can fix them before saving.
export function parseMarksSheet(rows, kids, max) {
  const headers = Object.keys(rows[0] ?? {});
  const rollCol = findCol(headers, [/roll/]);
  const nameCol = findCol(headers, [/^name$/]);
  if (!rollCol && !nameCol) throw new Error("Couldn't find a Roll No or Name column");
  const markCol = marksColumn(headers, rollCol, nameCol);
  if (!markCol) throw new Error('Couldn\'t tell which column holds the marks — name it "Marks"');

  const byRoll = new Map(kids.filter((k) => text(k.roll_no)).map((k) => [norm(k.roll_no), k]));
  const byName = new Map(kids.map((k) => [norm(k.name), k]));

  const matched = [];
  const unmatched = [];
  const seen = new Set();
  for (const row of rows) {
    const rollv = rollCol ? text(row[rollCol]) : "";
    const namev = nameCol ? text(row[nameCol]) : "";
    if (!rollv && !namev) continue;
    const kid = (rollv && byRoll.get(norm(rollv))) || (namev && byName.get(norm(namev)));
    if (!kid || seen.has(kid.id)) {
      unmatched.push({ roll_no: rollv, name: namev });
      continue;
    }
    seen.add(kid.id);
    const raw = text(row[markCol]);
    if (!raw || /^ab$/i.test(raw)) {
      matched.push({ id: kid.id, value: "" });
      continue;
    }
    const num = Number(raw);
    const ok = Number.isFinite(num) && num >= 0 && num <= max;
    matched.push({ id: kid.id, value: ok ? String(num) : raw, invalid: !ok });
  }
  return { matched, unmatched };
}
