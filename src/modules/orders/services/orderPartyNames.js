export function normalizeOrderPartyCode(value) {
  return String(value || "").trim().toUpperCase();
}

export function formatAgentName(user = {}) {
  return [user.nome, user.cognome].map((value) => String(value || "").trim()).filter(Boolean).join(" ");
}

export function customerDisplayName(order = {}, namesByCode = new Map()) {
  const code = normalizeOrderPartyCode(order.codice_cliente);
  const storedName = String(order.ragione_sociale_cliente || "").trim();
  if (storedName && normalizeOrderPartyCode(storedName) !== code) return storedName;
  return namesByCode.get(code) || String(order.codice_cliente || "").trim() || "-";
}

export function agentDisplayName(order = {}, map = new Map(), agentsByCustomer = new Map()) {
  const customerCode = normalizeOrderPartyCode(order.codice_cliente);
  const code = normalizeOrderPartyCode(order.codice_agente_mexal) || agentsByCustomer.get(customerCode) || "";
  return String(order.agente_nome || "").trim() || map.get(code) || code || "-";
}
