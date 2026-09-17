// The calendar describes scheduled availability, not live check-ins.
export function plannedPresentCount(shifts, approvedAbsences) {
  const present = new Set();
  for (const shift of shifts) {
    let available = [[Date.parse(shift.starts_at), Date.parse(shift.ends_at)]];
    for (const absence of approvedAbsences.filter((item) => item.user_id === shift.user_id)) {
      const from = Date.parse(absence.starts_at);
      const to = Date.parse(absence.ends_at);
      available = available.flatMap(([start, end]) => {
        if (to <= start || from >= end) return [[start, end]];
        return [[start, Math.min(from, end)], [Math.max(to, start), end]].filter(([a, b]) => b > a);
      });
    }
    if (available.some(([start, end]) => end > start)) present.add(shift.user_id);
  }
  return present.size;
}
