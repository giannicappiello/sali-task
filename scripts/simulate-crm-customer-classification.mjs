import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";

function loadEnvironmentFile(fileName) {
  try {
    const source = readFileSync(resolve(process.cwd(), fileName), "utf8");
    for (const line of source.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
      if (!match) continue;
      const [, name, rawValue] = match;
      const value = rawValue.replace(/^(['"])(.*)\1$/, "$2").trim();
      if (!process.env[name] || value.length > process.env[name].length) process.env[name] = value;
    }
    return true;
  } catch {
    return false;
  }
}

function required(...names) {
  const value = names.map((name) => String(process.env[name] || "").trim()).find(Boolean);
  if (!value) throw new Error(`Configurazione locale mancante: ${names.join(" oppure ")}`);
  return value;
}

function normalize(value) {
  return String(value || "").trim().replace(/\s+/g, " ").toLocaleUpperCase("it-IT");
}

export function classifyCustomerAgent(value) {
  const agent = normalize(value);
  if (!agent || agent === "MARIA RIPA") return "conto_terzi";
  if (agent === "AMAZON" || agent === "ONLINE") return "online";
  return "b2b";
}

function agentLabel(agent) {
  const fullName = [agent?.nome, agent?.cognome].map((value) => String(value || "").trim()).filter(Boolean).join(" ");
  return fullName || String(agent?.codice || "").trim();
}

async function readAll(queryFactory, pageSize = 1000) {
  const rows = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await queryFactory(from, from + pageSize - 1);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < pageSize) return rows;
  }
}

export function summarizeCustomers(customers, agents) {
  const agentsByCode = new Map(agents.map((agent) => [normalize(agent.codice), agentLabel(agent)]));
  const summary = {
    totalCustomers: customers.length,
    duplicateCustomerCodes: 0,
    emptyOrNullAgent: 0,
    mariaRipa: 0,
    amazon: 0,
    online: 0,
    otherAgents: 0,
    expected: { contoTerzi: 0, b2b: 0, online: 0, unclassified: 0 },
    suspiciousValues: [],
  };
  const unusual = new Map();
  const customerCodes = new Set();

  for (const customer of customers) {
    const customerCode = normalize(customer.codice_cliente);
    if (customerCodes.has(customerCode)) summary.duplicateCustomerCodes += 1;
    else customerCodes.add(customerCode);
    const rawCode = String(customer.codice_agente_mexal || "").trim();
    const resolvedAgent = agentsByCode.get(normalize(rawCode)) || rawCode;
    const normalizedAgent = normalize(resolvedAgent);
    const area = classifyCustomerAgent(resolvedAgent);

    if (!normalizedAgent) summary.emptyOrNullAgent += 1;
    else if (normalizedAgent === "MARIA RIPA") summary.mariaRipa += 1;
    else if (normalizedAgent === "AMAZON") summary.amazon += 1;
    else if (normalizedAgent === "ONLINE") summary.online += 1;
    else summary.otherAgents += 1;

    if (area === "conto_terzi") summary.expected.contoTerzi += 1;
    else if (area === "online") summary.expected.online += 1;
    else if (area === "b2b") summary.expected.b2b += 1;
    else summary.expected.unclassified += 1;

    if (rawCode && !agentsByCode.has(normalize(rawCode))) {
      const key = normalize(rawCode);
      unusual.set(key, (unusual.get(key) || 0) + 1);
    }
  }

  summary.suspiciousValues = [...unusual.entries()]
    .map(([value, customersCount]) => ({ value, customers: customersCount, reason: "codice agente non risolto in mexal_agenti" }))
    .sort((left, right) => right.customers - left.customers || left.value.localeCompare(right.value));
  return summary;
}

async function main() {
  loadEnvironmentFile(".env");
  loadEnvironmentFile(".env.local");
  const url = required("SUPABASE_URL", "VITE_SUPABASE_URL");
  const key = required("SUPABASE_SERVICE_ROLE_KEY");
  const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  const [customers, agents] = await Promise.all([
    readAll((from, to) => supabase.from("ordini_clienti_cache").select("codice_cliente,codice_agente_mexal").order("codice_cliente").range(from, to)),
    readAll((from, to) => supabase.from("mexal_agenti").select("codice,nome,cognome,attivo_mexal").eq("attivo_mexal", true).order("codice").range(from, to)),
  ]);
  const summary = summarizeCustomers(customers, agents);
  console.log(JSON.stringify({ mode: "read-only", generatedAt: new Date().toISOString(), ...summary }, null, 2));
  if (summary.expected.unclassified !== 0) process.exitCode = 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(`Simulazione non completata: ${error.message}`);
    process.exitCode = 1;
  });
}
