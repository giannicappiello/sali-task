import { supabase } from "../../../lib/supabaseClient";

function normalizeCode(value) {
  return String(value || "").trim().toUpperCase();
}

function firstText(...values) {
  for (const value of values) {
    const normalized = String(value ?? "").trim();
    if (normalized) return normalized;
  }
  return "";
}

export function formatAgentName(row = {}) {
  const surname = firstText(row.cognome, row.surname);
  const name = firstText(row.nome, row.name);
  const surnameAndName = [surname, name].filter(Boolean).join(" ");
  if (surnameAndName) return surnameAndName;

  return firstText(
    row.cognome_nome,
    row.cognome_nome_agente,
    row.nome_completo,
    row.nominativo,
    row.descrizione,
    row.ragione_sociale,
    row.denominazione
  );
}

async function loadNamesFromLinkedUsers(normalizedCodes) {
  const { data: links, error: linksError } = await supabase
    .from("integrazioni_utenti")
    .select("utente_id,codice_agente_mexal")
    .eq("modulo", "gestione_ordini")
    .in("codice_agente_mexal", normalizedCodes);
  if (linksError) throw linksError;

  const userIds = [...new Set((links || []).map((row) => row.utente_id).filter(Boolean))];
  if (!userIds.length) return new Map();

  const { data: users, error: usersError } = await supabase
    .from("utenti")
    .select("id,nome,cognome")
    .in("id", userIds);
  if (usersError) throw usersError;

  const usersById = new Map((users || []).map((user) => [user.id, formatAgentName(user)]));
  return new Map(
    (links || [])
      .map((link) => [normalizeCode(link.codice_agente_mexal), usersById.get(link.utente_id)])
      .filter(([, name]) => Boolean(name))
  );
}

export async function loadAgentNameMap(codes = []) {
  const normalizedCodes = [...new Set(codes.map(normalizeCode).filter(Boolean))];
  if (!normalizedCodes.length) return new Map();

  // La fonte reale degli agenti del modulo Ordini è integrazioni_utenti → utenti.
  return loadNamesFromLinkedUsers(normalizedCodes);
}

export function agentDisplayName(order = {}, map = new Map()) {
  const code = normalizeCode(order.codice_agente_mexal);
  return (
    firstText(
      order.cognome_nome_agente,
      order.nome_cognome_agente,
      order.nome_agente,
      order.agente_nome,
      order.nominativo_agente
    ) ||
    map.get(code) ||
    "-"
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
