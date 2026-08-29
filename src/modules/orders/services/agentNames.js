import { supabase } from "../../../lib/supabaseClient.js";
import { agentDisplayName, customerDisplayName, formatAgentName, normalizeOrderPartyCode } from "./orderPartyNames.js";

function normalizeCode(value) {
  return normalizeOrderPartyCode(value);
}

export { agentDisplayName, customerDisplayName, formatAgentName };

export async function loadCustomerDirectory(codes = []) {
  const normalizedCodes = [...new Set(codes.map(normalizeCode).filter(Boolean))];
  if (!normalizedCodes.length) return { namesByCode: new Map(), agentsByCustomer: new Map() };

  const { data: customers, error } = await supabase
    .from("ordini_clienti_cache")
    .select("codice_cliente,ragione_sociale,codice_agente_mexal")
    .in("codice_cliente", normalizedCodes);
  if (error) throw error;

  const namesByCode = new Map();
  const agentsByCustomer = new Map();
  for (const customer of customers || []) {
    const code = normalizeCode(customer.codice_cliente);
    const name = String(customer.ragione_sociale || "").trim();
    const agentCode = normalizeCode(customer.codice_agente_mexal);
    if (code && name && normalizeCode(name) !== code) namesByCode.set(code, name);
    if (code && agentCode) agentsByCustomer.set(code, agentCode);
  }
  return { namesByCode, agentsByCustomer };
}

export async function loadAgentNameMap(codes = []) {
  const normalizedCodes = [...new Set(codes.map(normalizeCode).filter(Boolean))];
  if (!normalizedCodes.length) return new Map();

  const { data: agents, error } = await supabase
    .from("mexal_agenti")
    .select("codice,nome,cognome")
    .in("codice", normalizedCodes);
  if (error) throw error;

  return new Map(
    (agents || [])
      .map((agent) => [normalizeCode(agent.codice), formatAgentName(agent)])
      .filter(([, name]) => Boolean(name))
  );
}

export function orderNumberValue(order = {}) {
  const raw = String(order.numero_ordine_visualizzato || order.numero_ordine || "");
  const matches = raw.match(/\d+/g);
  return matches?.length ? Number(matches.join("")) : 0;
}

export function sortOrdersNewestFirst(rows = []) {
  return [...rows].sort((a, b) => {
    const dateDiff = String(b.data_ordine || "").localeCompare(String(a.data_ordine || ""));
    if (dateDiff) return dateDiff;
    return orderNumberValue(b) - orderNumberValue(a);
  });
}
