import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { partitionAgentChanges } from "./sync-agents.js";

const baseAgent = {
  codice: "602.001",
  nome: "Mario",
  cognome: "Rossi",
  email: "mario@example.test",
  telefono: "123",
  attivo_mexal: true,
  dati_mexal: { codice: "602.001", recapiti: { telefono: "123", email: "mario@example.test" } },
};

test("la sincronizzazione distingue inserimenti, modifiche e agenti invariati", () => {
  const activeAgents = [
    { ...baseAgent, ultimo_sync_mexal: "2026-09-15T09:22:00Z" },
    { ...baseAgent, codice: "602.002", email: "nuovo@example.test", dati_mexal: { codice: "602.002" } },
    { ...baseAgent, codice: "602.003", cognome: "Verdi", dati_mexal: { codice: "602.003" } },
  ];
  const existingAgents = [
    { ...baseAgent, dati_mexal: { recapiti: { email: "mario@example.test", telefono: "123" }, codice: "602.001" } },
    { ...baseAgent, codice: "602.003", cognome: "Bianchi", dati_mexal: { codice: "602.003" } },
  ];

  const changes = partitionAgentChanges(activeAgents, existingAgents);

  assert.deepEqual(changes.inserted.map((agent) => agent.codice), ["602.002"]);
  assert.deepEqual(changes.updated.map((agent) => agent.codice), ["602.003"]);
  assert.deepEqual(changes.unchanged.map((agent) => agent.codice), ["602.001"]);
});

test("il trigger CRM ignora gli UPSERT che non cambiano i dati agente", async () => {
  const migration = await readFile(new URL("../../supabase/migrations/20260915110000_avoid_redundant_agent_crm_refresh.sql", import.meta.url), "utf8");

  assert.match(migration, /when\s*\([\s\S]*old\.codice is distinct from new\.codice/i);
  assert.match(migration, /old\.nome is distinct from new\.nome/i);
  assert.match(migration, /old\.cognome is distinct from new\.cognome/i);
  assert.match(migration, /old\.attivo_mexal is distinct from new\.attivo_mexal/i);
});
