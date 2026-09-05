import { crmTypeConfig } from "./crmConfig";

export function crmCustomerKey({ customerKey, customerCode, accountId }) {
  if (customerKey?.startsWith("mexal:") || customerKey?.startsWith("crm:")) return customerKey;
  if (customerCode) return `mexal:${customerCode}`;
  if (accountId) return `crm:${accountId}`;
  return "";
}
export function crmCustomerPath(crmType, identity) {
  const key = crmCustomerKey(identity);
  if (!key) return "";
  if (crmType === "brand_direct") return crmTypeConfig(crmType).basePath;
  return `${crmTypeConfig(crmType).basePath}/clienti/${encodeURIComponent(key)}`;
}
