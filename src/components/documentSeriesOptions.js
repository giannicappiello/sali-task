function value(record, key) { return String(record?.[key] ?? "").trim().toUpperCase(); }

/** A series may be selected for either OCM or OCX; Mexal commonly labels both as OC. */
export function isCustomerOrderSeries(record) {
  const type = value(record, "tipo_documento");
  const acronym = value(record, "sigla_documento");
  if (["OC", "OX", "OCM", "OCX"].includes(type) || ["OC", "OX", "OCM", "OCX"].includes(acronym)) return true;
  const description = String(record?.descrizione ?? "").trim();
  return !type && !acronym && Boolean(String(record?.serie ?? "").trim()) && /ordin|client|customer|\boc[mx]?\b/i.test(description);
}

export function customerOrderSeriesOptions(series) {
  return (series || []).filter(isCustomerOrderSeries);
}
