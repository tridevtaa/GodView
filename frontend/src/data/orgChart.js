// Builds the staff org chart. Everyone is placed from their designation
// (director, principal, vice principal, coordinators and HODs, then teachers,
// office and support staff), unless the owner set who they report to.
//
// Leaders are their own boxes. Everyone else under a leader is gathered into
// groups (Teachers, Office, Support, Other staff) so a school with 60 teachers
// still fits on screen. Someone with an explicit "reports to" always gets their
// own box under that person.

// Words that make someone a team lead ("Admin Head", "Primary Coordinator").
const LEAD_WORDS = /\b(coordinator|co-ordinator|hod|head|in-?charge|incharge|supervisor|dean|warden)\b/i;

// Tiers, top to bottom. [tier, test on the designation]
const TIERS = [
  ["head", /\b(director|chairman|chairperson|chair person|founder|owner|correspondent|trustee|president|secretary|managing)\b/i],
  ["principal", /\b(principal|head ?master|head ?mistress|headmaster|headmistress)\b/i],
  ["lead", LEAD_WORDS],
  ["office", /\b(admin|administrator|office|accountant|accounts|clerk|cashier|reception|receptionist|front desk|operator|data entry|registrar|superintendent|it\b|computer)\b/i],
  ["support", /\b(transport|bus|driver|conductor|peon|guard|security|helper|maid|ayah|aaya|sweeper|cleaner|gardener|mali|cook|attendant|chowkidar|watchman|housekeeping|electrician|plumber|khalasi)\b/i],
  ["teacher", /\b(teacher|teach|pgt|tgt|prt|ntt|lecturer|faculty|tutor|educator|instructor|coach|trainer)\b/i],
];
const VICE = /\bvice|deputy|assistant principal|asst\.? principal\b/i;

// The tier of a designation. Blank counts as a teacher (as in App access).
export function tierOf(designation = "") {
  const d = designation.trim();
  if (!d) return "teacher";
  if (/principal|head ?(master|mistress)/i.test(d) && VICE.test(d)) return "vice";
  for (const [tier, test] of TIERS) if (test.test(d)) return tier;
  return "other";
}

const RANK = { head: 0, principal: 1, vice: 2, lead: 3, teacher: 4, office: 5, support: 6, other: 7 };
const LEADERS = new Set(["head", "principal", "vice", "lead"]);
export const GROUPS = [
  ["teacher", "Teachers"],
  ["office", "Office"],
  ["support", "Support staff"],
  ["other", "Other staff"],
];

const byRankThenName = (a, b) => RANK[a.tier] - RANK[b.tier] || String(a.person.name ?? "").localeCompare(String(b.person.name ?? ""));

// staff: employee rows. Returns { roots, nodes } where each node is
// { person, tier, auto (placed from designation, not set), children: [node],
//   groups: [{ tier, label, members: [node] }] }, and nodes maps id to node.
export function buildOrgChart(staff) {
  const active = staff.filter((p) => p.status !== "left");
  const nodes = new Map(active.map((p) => [p.id, { person: p, tier: tierOf(p.designation), children: [], groups: [], parent: null, auto: true }]));
  const all = [...nodes.values()].sort(byRankThenName);
  const first = (tier) => all.find((n) => n.tier === tier) ?? null;
  const top = first("head");
  const principal = first("principal");
  const vice = first("vice");

  // Where the designation puts someone (before any explicit line).
  const autoParent = (n) => {
    const upFrom = { head: [], principal: [top], vice: [principal, top], lead: [vice, principal, top] }[n.tier] ?? [principal, top];
    // Office and support staff sit under their head ("Admin Head", "Transport In-charge").
    if (n.tier === "office" || n.tier === "support") {
      const head = all.find((l) => l.tier === "lead" && l !== n && tierOf(String(l.person.designation ?? "").replace(LEAD_WORDS, "")) === n.tier);
      if (head) return head;
    }
    // Teachers sit under the coordinator or HOD of their department, if there is one.
    if (n.tier === "teacher") {
      const dept = String(n.person.department ?? "").trim().toLowerCase();
      const lead = dept && all.find((l) => l.tier === "lead" && `${l.person.designation} ${l.person.department ?? ""}`.toLowerCase().includes(dept));
      if (lead) return lead;
      upFrom.unshift(vice);
    }
    return upFrom.find((p) => p && p !== n) ?? null;
  };

  // An explicit line wins unless it points outside this list or loops back.
  const loops = (n, boss) => {
    for (let b = boss, steps = 0; b && steps < 200; b = nodes.get(b.person.reports_to) ?? null, steps++) if (b === n) return true;
    return false;
  };
  for (const n of all) {
    const boss = nodes.get(n.person.reports_to);
    if (boss && boss !== n && !loops(n, boss)) {
      n.parent = boss;
      n.auto = false;
    }
  }
  for (const n of all) if (n.auto) n.parent = autoParent(n);
  // A loop through automatic lines (rare: odd designations) is cut at the top.
  for (const n of all) if (n.parent && loops(n, n.parent)) n.parent = null;

  // Leaders and explicitly placed people get their own box; the rest are grouped.
  const roots = [];
  for (const n of all) {
    if (!n.parent) {
      roots.push(n);
      continue;
    }
    if (LEADERS.has(n.tier) || !n.auto) {
      n.parent.children.push(n);
    } else {
      let g = n.parent.groups.find((x) => x.tier === n.tier);
      if (!g) n.parent.groups.push((g = { tier: n.tier, label: GROUPS.find(([t]) => t === n.tier)[1], members: [] }));
      g.members.push(n);
    }
  }
  // Someone in a group who has people under them gets their own box after all.
  for (const n of all) {
    for (const g of n.groups) {
      const leads = g.members.filter((m) => m.children.length || m.groups.length);
      g.members = g.members.filter((m) => !leads.includes(m));
      n.children.push(...leads);
    }
    n.groups = n.groups.filter((g) => g.members.length).sort((a, b) => RANK[a.tier] - RANK[b.tier]);
    n.children.sort(byRankThenName);
  }

  // People with nobody above them and nobody below gather into groups at the
  // top level too, instead of a long row of loose boxes.
  const loose = roots.filter((n) => !LEADERS.has(n.tier) && n.auto && !n.children.length && !n.groups.length);
  const kept = roots.filter((n) => !loose.includes(n));
  const looseGroups = GROUPS.map(([tier, label]) => ({ tier, label, members: loose.filter((n) => n.tier === tier) })).filter((g) => g.members.length);
  return { roots: kept, looseGroups, nodes };
}

// Everyone below a node (to keep "reports to" from making a loop).
export function below(node) {
  const out = new Set();
  const walk = (n) => {
    for (const c of n.children) {
      out.add(c.person.id);
      walk(c);
    }
    for (const g of n.groups) for (const m of g.members) out.add(m.person.id);
  };
  walk(node);
  return out;
}
