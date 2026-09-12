// Authorization collections are sets: database row/key order must not reset pages.
export function accessSnapshotSignature(value) {
  function canonical(item) {
    if (Array.isArray(item)) return item.map(canonical).sort((a, b) => {
      const left = JSON.stringify(a), right = JSON.stringify(b);
      return left < right ? -1 : left > right ? 1 : 0;
    });
    if (item && typeof item === "object") {
      return Object.fromEntries(Object.keys(item).sort().map((key) => [key, canonical(item[key])]));
    }
    return item;
  }
  return JSON.stringify(canonical(value));
}

export function retainEqualAccessValue(previous, next) {
  return accessSnapshotSignature(previous) === accessSnapshotSignature(next) ? previous : next;
}

export function retainAccessProfile(previous, next) {
  // Presence timestamps can change, but must not recreate the role object used
  // by permission callbacks and restart every page's data-loading effects.
  return retainEqualAccessValue(previous, {
    ...next,
    ruoli: retainEqualAccessValue(previous?.ruoli, next.ruoli),
    reparto_ids: retainEqualAccessValue(previous?.reparto_ids, next.reparto_ids),
    reparti_multipli: retainEqualAccessValue(previous?.reparti_multipli, next.reparti_multipli),
  });
}
