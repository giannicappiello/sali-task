import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PROGREMES_SYNC_TIMEOUT_MS } from "./progremes-modules.js";

test("le sincronizzazioni moduli ProgreMES hanno un timeout applicativo", () => {
  assert.equal(PROGREMES_SYNC_TIMEOUT_MS, 30 * 60 * 1000);
});

test("i run obsoleti e l'arresto manuale liberano subito il lock", async () => {
  const source = await readFile(new URL("./progremes-modules.js", import.meta.url), "utf8");
  assert.match(source, /cleanupStaleProgremesRuns\(supabase\)/);
  assert.match(source, /\.lt\("iniziata_il", cutoff\)/);
  assert.match(source, /arresto_richiesto: true,[\s\S]*stato: "arrestata"/);
  assert.match(source, /\.eq\("stato", "in_esecuzione"\)\.select\("id"\)\.maybeSingle\(\)/);
  assert.match(source, /\.eq\("id", run\.id\)\.in\("stato", ACTIVE_RUN_STATES\)/);
});

test("la sola consultazione dello storico non avvia una sincronizzazione", async () => {
  const source = await readFile(new URL("./progremes-modules.js", import.meta.url), "utf8");
  const listBody = source.slice(source.indexOf("export async function listProgremesIntegration"), source.indexOf("export function normalizeProgremesCatalog"));
  assert.doesNotMatch(listBody, /ensureProgremesCatalogFresh/);
});
