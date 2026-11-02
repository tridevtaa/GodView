// Students with a birthday in the next 7 days (today first)
export function birthdaysSoon(people) {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return people
    .filter((p) => p.dob)
    .map((p) => {
      const b = new Date(p.dob);
      let next = new Date(start.getFullYear(), b.getMonth(), b.getDate());
      if (next < start) next = new Date(start.getFullYear() + 1, b.getMonth(), b.getDate());
      return { p, days: Math.round((next - start) / 864e5) };
    })
    .filter((x) => x.days <= 6)
    .sort((a, b) => a.days - b.days)
    .map((x) => x.p);
}
