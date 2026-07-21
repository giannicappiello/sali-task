export const DASHBOARD_DOCUMENT_FIELDS = ["numero_ocm", "numero_ocx", "numero_oci"];

export function matchesDashboardOrder(order, query, statusFilter = "") {
  if (statusFilter && order.stato !== statusFilter) return false;
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

export function filterDashboardOrders(orders, query, statusFilter) {
  return (orders || []).filter((order) => matchesDashboardOrder(order, query, statusFilter));
}
