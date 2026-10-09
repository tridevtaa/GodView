// Pure helpers for the incremental load in usePeople (no Firebase imports, so
// they can be tested on their own).

const updatedMillis = (row) => row.updated_at?.toMillis?.() ?? 0;

// Cached rows overwritten by changed ones (same id), plus new ones.
export function mergeRows(cached, changed) {
  const byId = new Map(cached.map((r) => [r.id, r]));
  changed.forEach((r) => byId.set(r.id, r));
  return [...byId.values()];
}

// Next sync mark: newest server timestamp seen, never below the previous mark
// and never 0 after a successful load.
export function nextMark(rows, since) {
  return rows.reduce((max, r) => Math.max(max, updatedMillis(r)), since) || 1;
}
