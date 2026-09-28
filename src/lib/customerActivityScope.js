// This only filters records already returned by the authenticated, RLS-protected query.
export function matchesCustomerActivityScope(dataScope, customerKey) {
  const codes = dataScope?.customerCodes?.length
    ? dataScope.customerCodes
    : [dataScope?.customerCode].filter(Boolean);
  const key = String(customerKey || "").trim();
  if (!key.startsWith("mexal:")) return false;
  const code = key.slice(6).trim().toUpperCase();
  return Boolean(code) && codes.some((value) => String(value).trim().toUpperCase() === code);
}
