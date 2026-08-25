import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../ai/crm-brief.js", import.meta.url), "utf8");

test("il contesto AI Digital usa soltanto la RPC aggregata protetta dalle RLS", () => {
  assert.match(source, /scoped\.rpc\("crm_digital_dashboard"/);
  assert.match(source, /target_channel: null/);
  assert.match(source, /target_marketplace: null/);
  assert.doesNotMatch(source, /crm_external_/);
});

test("i dettagli per canale rispettano i moduli assegnati all'utente", () => {
  for (const moduleCode of [
    "crm_online_ecommerce",
    "crm_online_mailing",
    "crm_online_amazon",
    "crm_online_adv",
  ]) assert.match(source, new RegExp(moduleCode));
  assert.match(source, /!auth\.isAdmin && !allowedModules\.has\(moduleCode\)/);
});

test("il prompt vieta dati personali, segreti e interpretazioni di null come zero", () => {
  assert.match(source, /esclusivamente aggregati degli ultimi 90 giorni/);
  assert.match(source, /clienti, email, consensi, identificativi personali, credenziali o segreti/);
  assert.match(source, /valori null indicano dati insufficienti, non risultati pari a zero/);
});
test("il ramo CRM Online invia soltanto brief e aggregati Digital", () => {
  const onlineStart = source.indexOf('if (crmType === "online")');
  const onlineBranch = source.slice(onlineStart, source.indexOf("} else {", onlineStart));
  assert.match(onlineBranch, /digitalAggregateQueries\(auth\)/);
  assert.doesNotMatch(onlineBranch, /crm_campaigns|crm_creators|crm_accounts|prodotti|v4_progetti/);
});

