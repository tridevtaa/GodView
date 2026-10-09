// Groups students into villages/towns from the text they already have
// (address, pick-up point, city), merging spelling variants, and matches
// them to the school's pinned areas. Pure functions.

// Words that aren't the village name.
const NOISE = new Set([
  "village", "vill", "vpo", "po", "p", "o", "v", "teh", "tehsil", "distt", "dist", "district", "near", "h", "no",
  "house", "ward", "street", "gali", "road", "rd", "bus", "stand", "chowk", "india", "haryana", "hr", "punjab", "himachal", "up", "pradesh",
]);
// District or state names say nothing about the village.
const TOO_WIDE = new Set(["ambala", "yamunanagar", "yamuna nagar", "panchkula", "kurukshetra", "saharanpur", "haryana", "india"]);

const clean = (s) =>
  String(s ?? "")
    .toLowerCase()
    .replace(/[^a-z ]+/g, " ")
    .split(/\s+/)
    .filter((w) => w && !NOISE.has(w))
    .join(" ")
    .trim();

// Spelling-insensitive key: the consonants plus the final vowel sound, so
// "Hema Majra" = "Hemamajra" = "Hemamjara", "Jeolly" = "Jolly" = "Joeli",
// "Jhharumajra" = "Jharumajra", "Dhanaura" = "Dhanoura" = "Dhanura", while
// "Dulyana" and "Dulyani" stay apart.
export function areaKey(name) {
  const w = clean(name).replace(/ /g, "");
  if (!w) return "";
  const end = /[aeiouy]$/.test(w) ? ({ a: "a", e: "i", i: "i", y: "i", o: "u", u: "u" })[w.at(-1)] : "";
  let k = w.replace(/(.)\1+/g, "$1").replace(/([bcdfgjklmnpqrstvxz])h/g, "$1");
  k = k.replace(/[aeiouyw]/g, "").replace(/(.)\1+/g, "$1");
  return k + end;
}

const title = (s) => clean(s).replace(/\b\w/g, (c) => c.toUpperCase());

// The best place name we have for a student, or "".
export function placeText(p) {
  for (const raw of [p.address, p.pickup_point, p.city]) {
    const c = clean(raw);
    if (!c || TOO_WIDE.has(c)) continue;
    // Long addresses: the last meaningful part usually names the village.
    const parts = String(raw).split(/[,/]+/).map(clean).filter((x) => x && !TOO_WIDE.has(x));
    const pick = parts.length > 1 ? parts[parts.length - 1] : c;
    if (pick.length >= 3) return pick;
  }
  return "";
}

// Village list from students: [{ key, name, aliases, count }], biggest first.
// The name is the most common spelling.
export function buildAreas(students) {
  const byKey = new Map();
  for (const s of students) {
    const text = placeText(s);
    if (!text) continue;
    const key = areaKey(text);
    if (!key) continue;
    const a = byKey.get(key) ?? { key, spellings: new Map(), count: 0 };
    a.spellings.set(text, (a.spellings.get(text) ?? 0) + 1);
    a.count += 1;
    byKey.set(key, a);
  }
  return [...byKey.values()]
    .map((a) => ({
      key: a.key,
      name: title([...a.spellings].sort((x, y) => y[1] - x[1])[0][0]),
      aliases: [a.key],
      count: a.count,
    }))
    .sort((x, y) => y.count - x.count || x.name.localeCompare(y.name));
}

// Where a student shows on the map: own pin > chosen area > matched area.
// Returns { lat, lng, area, exact } or null.
export function locate(student, areas, byAlias) {
  if (student.home_lat != null && student.home_lng != null) {
    return { lat: student.home_lat, lng: student.home_lng, area: areas.find((a) => a.id === student.area_id) ?? matchArea(student, byAlias), exact: true };
  }
  const area = areas.find((a) => a.id === student.area_id) ?? matchArea(student, byAlias);
  if (area && area.lat != null) return { lat: area.lat, lng: area.lng, area, exact: false };
  return area ? { area, lat: null, lng: null, exact: false } : null;
}

export function aliasIndex(areas) {
  const m = new Map();
  areas.forEach((a) => [areaKey(a.name), ...(a.aliases ?? [])].forEach((k) => k && m.set(k, a)));
  return m;
}

export function matchArea(student, byAlias) {
  const text = placeText(student);
  return text ? byAlias.get(areaKey(text)) ?? null : null;
}
