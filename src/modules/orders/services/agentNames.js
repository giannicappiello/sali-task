import { supabase } from "../../../lib/supabaseClient";

function normalizeCode(value) {
  return String(value || "").trim().toUpperCase();
}

export function formatAgentName(user = {}) {
  return [user.nome, user.cognome].map((value) => String(value || "").trim()).filter(Boolean).join(" ");
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

export function agentDisplayName(order = {}, map = new Map()) {
  const code = normalizeCode(order.codice_agente_mexal);
  return String(order.agente_nome || "").trim() || map.get(code) || "-";
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
