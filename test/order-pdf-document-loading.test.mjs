import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { sanitizeMexalContract } from "../scripts/mexal-capture-order-contract.mjs";

const fulfillment = await readFile("src/modules/orders/services/orderFulfillment.js", "utf8");
const detail = await readFile("src/modules/orders/pages/OrderDetail.jsx", "utf8");

assert.match(fulfillment, /from\("ordini_documenti_mexal"\)\.select\("tipo_documento,sigla,serie,numero,cod_modulo"\)/,
  "il caricamento reale del dettaglio seleziona tipo, serie e numero dalla tabella documenti");
assert.match(fulfillment, /order: \{ \.\.\.order, mexal_documents: documents \|\| \[\] \}/,
  "il risultato della query viene collegato all'ordine passato al PDF");
assert.match(detail, /loadOrderDetail\(orderId\)[\s\S]*setOrder\(result\.order\)[\s\S]*setLines\(result\.lines\)/,
  "la schermata dettaglio usa l'ordine arricchito dalla query prima del download");

const sanitized = sanitizeMexalContract({ cod_conto: "Cliente riservato", quantita: [[1, 8]], indirizzo: null });
assert.deepEqual(sanitized, { cod_conto: { type: "string" }, quantita: [[{ type: "number" }, { type: "number" }]], indirizzo: { type: "null" } },
  "la cattura diagnostica conserva forma e tipi, senza valori personali");

console.log("order PDF document loading: frontend query, attachment, and sanitized diagnostic shape verified");
