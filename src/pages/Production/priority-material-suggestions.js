export function suggestMaterialDisengagements(materials, startAt) {
  const result = {};
  const requested = new Date(startAt).getTime();
  if (!Number.isFinite(requested)) return result;
  for (const material of materials) {
    if (!material.eligible) continue;
    let remaining = Math.max(0, Number(material.minimumRelease ?? material.missing));
    const donors = material.donors.filter(d => d.eligible && d.plannedStart && new Date(d.plannedStart).getTime() > requested)
      .sort((a, b) => new Date(b.plannedStart) - new Date(a.plannedStart) || a.orderId - b.orderId).slice(0, 30);
    for (const donor of donors) {
      const quantity = Math.min(remaining, Math.max(0, Number(donor.reserved)));
      if (quantity <= 0) continue;
      result[`${material.articleCode}:${donor.orderId}`] = quantity;
      remaining = Math.max(0, Math.round((remaining - quantity) * 1e6) / 1e6);
    }
  }
  return result;
}
