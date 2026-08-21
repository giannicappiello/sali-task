export const DASHBOARD_DOCUMENT_FIELDS = ["numero_ocm", "numero_ocx", "numero_oci"];

export function getDashboardOrderMonth(order) {
  const explicitMonth = String(order?.mese_ordine || "").slice(0, 7);
  if (/^\d{4}-\d{2}$/.test(explicitMonth)) return explicitMonth;
  const orderDate = String(order?.data_ordine || "").slice(0, 7);
  return /^\d{4}-\d{2}$/.test(orderDate) ? orderDate : "";
}

export function matchesDashboardOrder(order, query, statusFilter = "", monthFilter = "") {
  if (statusFilter && order.stato !== statusFilter) return false;
  if (monthFilter && getDashboardOrderMonth(order) !== monthFilter) return false;
  const term = String(query ?? "").trim().toLowerCase();
  if (!term) return true;
  return [
    order.numero_ordine,
    order.ragione_sociale_cliente,
    order.codice_cliente,
    order.codice_agente_mexal,
    order.stato,
    ...DASHBOARD_DOCUMENT_FIELDS.map((field) => order[field]),
    ...(order.documenti_mexal || []).map((document) => document.numero),
  ].some((value) => String(value ?? "").toLowerCase().includes(term));
}

export function filterDashboardOrders(orders, query, statusFilter, monthFilter = "") {
  return (orders || []).filter((order) => matchesDashboardOrder(order, query, statusFilter, monthFilter));
}
