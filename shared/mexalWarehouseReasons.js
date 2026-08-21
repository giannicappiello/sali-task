export const MEXAL_WAREHOUSE_REASONS = Object.freeze({
  "1": "Vendita diretta",
  "2": "Vendita Online",
  "3": "Vendita C/Terzi",
  "10": "Campionatura",
});

export function normalizeWarehouseReasonCode(value) {
  const scalar = Array.isArray(value) ? value.flat(Infinity).at(-1) : value;
  return String(scalar ?? "").trim();
}

export function warehouseReasonDescription(code, fallback = "") {
  const normalizedCode = normalizeWarehouseReasonCode(code);
  return MEXAL_WAREHOUSE_REASONS[normalizedCode] || String(fallback ?? "").trim();
}
