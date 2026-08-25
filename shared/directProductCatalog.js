export const DIRECT_MEXAL_PRODUCT_PREFIXES = Object.freeze(["IT", "MKT"]);
export const DIRECT_PRODUCT_PREFIXES = Object.freeze([...DIRECT_MEXAL_PRODUCT_PREFIXES, "IMP"]);

export function normalizeDirectProductCode(value) {
  return String(value || "").trim().toUpperCase();
}

export function directProductPrefix(value) {
  const code = normalizeDirectProductCode(value);
  return DIRECT_PRODUCT_PREFIXES.find((prefix) => code.startsWith(prefix)) || "";
}

export function isDirectProductCode(value) {
  return Boolean(directProductPrefix(value));
}

export function isDirectMexalProductCode(value) {
  const code = normalizeDirectProductCode(value);
  return DIRECT_MEXAL_PRODUCT_PREFIXES.some((prefix) => code.startsWith(prefix));
}

export function applyDirectMexalProductFilters(query) {
  return query
    .eq("attivo_mexal", true)
    .eq("mostra_in_app", true)
    .or("codice_mexal.ilike.IT%,codice_mexal.ilike.MKT%");
}
