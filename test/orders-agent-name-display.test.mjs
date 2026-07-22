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

assert.match(agentNames, /\[user\.cognome, user\.nome\][\s\S]*\.filter\(Boolean\)\.join\(" "\)/,
  "Mario Rossi viene formattato come Rossi Mario");
assert.match(agentNames, /\.from\("integrazioni_utenti"\)[\s\S]*\.select\("utente_id,codice_agente_mexal"\)[\s\S]*\.in\("codice_agente_mexal", normalizedCodes\)/,
  "il codice agente Mexal viene risolto attraverso integrazioni_utenti in una sola query");
assert.match(agentNames, /\.from\("utenti"\)[\s\S]*\.select\("id,nome,cognome"\)[\s\S]*\.in\("id", userIds\)/,
  "gli utenti collegati vengono recuperati in una sola query");
assert.match(agentNames, /map\.get\(code\) \|\| "-"/,
  "un nominativo mancante restituisce - e non il codice agente");
assert.doesNotMatch(agentNames, /map\.get\(code\) \|\|\s*code/,
  "il codice agente non e un fallback visibile");

assert.match(orders, /agentDisplayName, loadAgentNameMap/,
  "l'elenco ordini usa la funzione condivisa");
assert.match(detail, /setAgentName\(result\.order\.agente_nome \|\| "-"\)/,
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
