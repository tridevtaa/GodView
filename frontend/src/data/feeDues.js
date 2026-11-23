// Fee dues helpers shared by the student's Fees tab (FeeLedger.jsx) and the
// collect form (CollectForm.jsx).

export const n = (v) => Number(v) || 0;
// "Monthly fee" -> "Monthly", for lists of several fees
export const shortHead = (h) => (h ?? "Fee").replace(/\s*fees?$/i, "") || h;
export const isMonth = (p) => /^\d{4}-\d{2}$/.test(p ?? "");
export const nextMonth = (p) => {
  const [y, m] = p.split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
};
export const isTransport = (name) => /transport|\bbus\b|\bvan\b|conveyance/i.test(name ?? "");
// Dues from before this session: the old system's balances, or last year
// A one-off charge added on the student's Fees tab (add_misc_charge)
export const isMisc = (d) => String(d?.period ?? "").startsWith("misc-");
export const isEarlier = (d, sid) => d.period === "opening" || d.session_id !== sid;

// The order record_payment() pays dues in: oldest due date first
export const payOrder = (a, b) => String(a.due_date ?? "").localeCompare(String(b.due_date ?? "")) || String(a.created_at ?? "").localeCompare(String(b.created_at ?? ""));

// Dues as words, months run together: "Apr – Jul 2026, Aug 2026 (part)".
// items: [{ due, part, rest }] (rest: the remainder of a part-paid due). Several fees: "Monthly Apr – Jul 2026 · Transport Dec 2026".
// named: always say the fee type, even when there's only one.
export function describeDues(items, named = false) {
  const byHead = new Map();
  for (const it of items) {
    const k = it.due.head_name ?? "Fee";
    if (!byHead.has(k)) byHead.set(k, []);
    byHead.get(k).push(it);
  }
  const parts = [...byHead].map(([head, list]) => {
    list.sort((a, b) => String(a.due.period).localeCompare(String(b.due.period)));
    const runs = [];
    for (const it of list) {
      const run = runs.at(-1);
      const last = run?.at(-1);
      if (last && !last.part && !it.part && !last.rest && !it.rest && isMonth(last.due.period) && it.due.period === nextMonth(last.due.period)) run.push(it);
      else runs.push([it]);
    }
    const text = runs
      .map((r) =>
        r.length === 1
          ? `${r[0].due.label}${r[0].part ? " (part)" : r[0].rest ? " (rest)" : ""}`
          : `${r[0].due.label.split(" ")[0]} – ${r.at(-1).due.label}`
      )
      .join(", ");
    return byHead.size > 1 || named ? `${shortHead(head)} ${text}` : text;
  });
  return parts.join(" · ");
}

// What a payment of `amount` would clear, the way record_payment() does it:
// the ticked dues first (`first`, ids), then the rest, each oldest first.
export function coverage(amount, open, first = null) {
  let left = n(amount);
  const items = [];
  const ahead = (d) => (first?.has(d.id) ? 0 : 1);
  for (const d of [...open].sort((a, b) => ahead(a) - ahead(b) || payOrder(a, b))) {
    if (left <= 0) break;
    const take = Math.min(left, n(d.balance));
    items.push({ due: d, part: take < n(d.balance), rest: take >= n(d.balance) && n(d.paid) > 0 });
    left -= take;
  }
  return { items, credit: Math.max(0, left) };
}
