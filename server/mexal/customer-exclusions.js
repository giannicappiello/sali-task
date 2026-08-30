function normalizeCustomerCode(value) {
  return String(value ?? "").trim();
}

export function filterExcludedClients(clients, excludedCodes) {
  const blocked = excludedCodes instanceof Set ? excludedCodes : new Set(excludedCodes || []);
  return (clients || []).filter(
    (client) => !blocked.has(normalizeCustomerCode(client?.codice_cliente)),
  );
}
