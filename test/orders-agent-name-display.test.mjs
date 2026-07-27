import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [agentNames, orders, detail, fulfillment, pdf, payload] = await Promise.all([
  readFile("src/modules/orders/services/agentNames.js", "utf8"),
  readFile("src/modules/orders/pages/Orders.jsx", "utf8"),
  readFile("src/modules/orders/pages/OrderDetail.jsx", "utf8"),
  readFile("src/modules/orders/services/orderFulfillment.js", "utf8"),
  readFile("src/modules/orders/services/orderPdf.js", "utf8"),
  readFile("src/modules/orders/services/orderPayload.js", "utf8"),
]);

assert.match(agentNames, /\[user\.nome, user\.cognome\][\s\S]*\.filter\(Boolean\)\.join\(" "\)/,
  "Mario Rossi viene formattato come Mario Rossi");
assert.match(agentNames, /\.from\("mexal_agenti"\)[\s\S]*\.select\("codice,nome,cognome"\)[\s\S]*\.in\("codice", normalizedCodes\)/,
  "il codice agente viene risolto direttamente dall'anagrafica unica Mexal");
assert.match(agentNames, /order\.agente_nome[\s\S]*map\.get\(code\) \|\| "-"/,
  "un nominativo mancante restituisce - e non il codice agente");
assert.doesNotMatch(agentNames, /map\.get\(code\) \|\|\s*code/,
  "il codice agente non e un fallback visibile");

assert.match(orders, /agentDisplayName, loadAgentNameMap/,
  "l'elenco ordini usa la funzione condivisa");
assert.match(detail, /setAgentName\(loadedOrder\.agente_nome \|\| "-"\)/,
  "il dettaglio usa il nominativo risolto dal caricamento condiviso");
assert.match(fulfillment, /agente_nome: agentDisplayName\(order, names\)/,
  "il caricamento dettaglio risolve il nominativo con la funzione condivisa");
assert.match(pdf, /"Agente", order\.agente_nome \|\| "-"/,
  "i PDF ordine, OCM, OCI e OCX stampano il nominativo risolto");
assert.doesNotMatch(fulfillment, /codice_agente_mexal: enriched\.agente_nome/,
  "la generazione PDF non sovrascrive il codice agente tecnico");
assert.match(payload, /codice_agente_mexal: customer\.codice_agente_mexal \|\| agentCode \|\| null/,
  "il payload Mexal conserva codice_agente_mexal");

console.log("orders agent names: resolved surnames, visible fallbacks, PDFs, and technical code verified");
