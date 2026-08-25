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
  return `${crmTypeConfig(crmType).basePath}/clienti/${encodeURIComponent(key)}`;
}
