import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { sanitizeMexalContract } from "../scripts/mexal-capture-order-contract.mjs";

const fulfillment = await readFile("src/modules/orders/services/orderFulfillment.js", "utf8");
const detail = await readFile("src/modules/orders/pages/OrderDetail.jsx", "utf8");

assert.match(fulfillment, /from\("ordini_documenti_mexal"\)\s*\.select\("tipo_documento,serie,numero,stato"\)\s*\.eq\("ordine_id", orderId\)\s*\.not\("numero", "is", null\)/,
  "il caricamento reale usa ogni riferimento Mexal persistito, anche se un vecchio stato locale non è created");
assert.doesNotMatch(fulfillment, /\.eq\("stato", "created"\)/,
  "il PDF non scarta un documento realmente creato per un'etichetta locale di riconciliazione");
assert.match(fulfillment, /legacyMexalDocuments[\s\S]*numero_\$\{type\.toLowerCase\(\)\}/,
  "i numeri legacy della testata restano un fallback per gli ordini già creati");
assert.match(fulfillment, /mexal_documents: mergeMexalDocuments\(documents, order\)/,
  "il risultato della query e il fallback vengono collegati all'ordine passato al PDF");
assert.match(fulfillment, /await loadCreatedMexalDocuments\(order\.id\)[\s\S]*mergeMexalDocuments\(documents, order\)/,
  "il download ricarica esplicitamente i documenti prima di generare il PDF");
assert.match(detail, /loadOrderDetail\(orderId\)[\s\S]*setOrder\(result\.order\)[\s\S]*setLines\(result\.lines\)/,
  "la schermata dettaglio usa l'ordine arricchito dalla query prima del download");

const sanitized = sanitizeMexalContract({ cod_conto: "Cliente riservato", quantita: [[1, 8]], indirizzo: null });
assert.deepEqual(sanitized, { cod_conto: { type: "string" }, quantita: [[{ type: "number", value: 1 }, { type: "number" }]], indirizzo: { type: "null" } },
  "la cattura diagnostica conserva forma e tipi, senza valori personali");

assert.deepEqual(sanitizeMexalContract({ stato: "E", cod_modulo: "M", sospeso: false, prezzo: 15 }), {
  stato: { type: "string", value: "E" }, cod_modulo: { type: "string", value: "M" }, sospeso: { type: "boolean", value: false }, prezzo: { type: "number" },
}, "la whitelist conserva soltanto valori tecnici utili al confronto E/S");

console.log("order PDF document loading: persisted references, legacy fallback, and sanitized diagnostic shape verified");
