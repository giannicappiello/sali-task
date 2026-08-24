export const CRM_TYPES = Object.freeze({
  conto_terzi: { moduleCode: "crm_conto_terzi", label: "Conto Terzi", basePath: "/crm/conto-terzi" },
  b2b: { moduleCode: "crm_b2b", label: "B2B", basePath: "/crm/b2b" },
  online: { moduleCode: "crm_online", label: "Online", basePath: "/crm/online" },
});

export function crmTypeConfig(type) {
  return CRM_TYPES[type] || CRM_TYPES.conto_terzi;
}

export function formatMoney(value) {
  return value == null ? "Dato non disponibile" : new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" }).format(Number(value || 0));
}

export function formatDate(value) {
  return value ? new Date(value).toLocaleDateString("it-IT") : "—";
}
