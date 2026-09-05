export const CRM_TYPES = Object.freeze({
  conto_terzi: { moduleCode: "crm_conto_terzi", label: "PRIVATE", basePath: "/crm/conto-terzi" },
  b2b: { moduleCode: "crm_b2b", label: "DIRECT · BtoB", basePath: "/crm/b2b" },
  online: { moduleCode: "crm_online", label: "DIRECT · BtoC", basePath: "/crm/online" },
  brand_direct: { moduleCode: "crm_brand_direct", label: "BRAND DIRECT", basePath: "/crm/brand-direct" },
});

export const VIRTUAL_DIRECT_ACCOUNT_ID = "00000000-0000-4000-8000-000000000001";
export const VIRTUAL_DIRECT_CUSTOMER_KEY = `crm:${VIRTUAL_DIRECT_ACCOUNT_ID}`;

export function crmTypeConfig(type) {
  return CRM_TYPES[type] || CRM_TYPES.conto_terzi;
}

export function formatMoney(value) {
  return value == null ? "Dato non disponibile" : new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" }).format(Number(value || 0));
}

export function formatDate(value) {
  return value ? new Date(value).toLocaleDateString("it-IT") : "—";
}
