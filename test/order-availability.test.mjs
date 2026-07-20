import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  AVAILABILITY_CONCURRENCY,
  MAX_ORDER_LINES,
  availabilityLine,
  mapWithConcurrency,
  normalizeLines,
  summarize,
} from "../api/mexal/orders/check-availability.js";
import { buildAvailabilityPreview, buildAvailabilitySignature, getAvailabilityValidity, quantitiesForOrderLine } from "../src/modules/orders/services/availability.js";

assert.throws(() => normalizeLines([]), /obbligatorio/);
assert.throws(() => normalizeLines([{ productCode: "IT1", quantity: 0 }]), /Quantità non valida/);
assert.throws(() => normalizeLines([{ quantity: 1 }]), /Codice prodotto obbligatorio/);
assert.throws(() => normalizeLines(Array.from({ length: MAX_ORDER_LINES + 1 }, () => ({ productCode: "IT1", quantity: 1 }))), /al massimo/);
assert.deepEqual(normalizeLines([{ codice_articolo: " it001 ", quantita: 2 }, { productCode: "IT001", quantity: 3 }]), [{ productCode: "IT001", requestedQuantity: 5 }]);

const article = { codice: "IT001", qta_inventario: 8, qta_carico: 0, qta_scarico: 0, ord_cli_e: 2 };
assert.deepEqual(availabilityLine("IT001", 10, article), { productCode: "IT001", requestedQuantity: 10, availableQuantity: 6, confirmedQuantity: 6, missingQuantity: 4, status: "partial", message: null });
assert.equal(availabilityLine("IT001", 4, article).status, "available");
assert.equal(availabilityLine("IT001", 4, { codice: "IT001" }).status, "unavailable");
const summary = summarize([availabilityLine("IT001", 10, article), availabilityLine("IT002", 4, { codice: "IT002" }), { productCode: "IT003", requestedQuantity: 3, confirmedQuantity: 0, missingQuantity: 3, status: "error" }]);
assert.deepEqual(summary, { totalLines: 3, availableLines: 0, partialLines: 1, unavailableLines: 1, errorLines: 1, requestedQuantity: 17, confirmedQuantity: 6, missingQuantity: 11 });

let active = 0; let peak = 0;
await mapWithConcurrency(Array.from({ length: 20 }, (_, index) => index), AVAILABILITY_CONCURRENCY, async (value) => { active += 1; peak = Math.max(peak, active); await new Promise((resolve) => setTimeout(resolve, 2)); active -= 1; return value; });
assert.ok(peak <= AVAILABILITY_CONCURRENCY && peak > 1, "le richieste sono limitate ma concorrenti");

assert.deepEqual(buildAvailabilityPreview([{ codice_articolo: "IT001", descrizione: "Articolo" }], [{ productCode: "IT001", requestedQuantity: 10, confirmedQuantity: 6, missingQuantity: 4 }]), { ocm: [{ productCode: "IT001", description: "Articolo", requestedQuantity: 10, quantity: 6 }], ocx: [{ productCode: "IT001", description: "Articolo", requestedQuantity: 10, quantity: 4 }], oci: [] });

const orderLines = [{ codice_articolo: "IT002", quantita: 2, disponibilita: 99 }, { codice_articolo: " it001 ", quantita: 10, disponibilita: 99 }];
const customer = { codice_cliente: "C-01" };
const signature = buildAvailabilitySignature({ lines: orderLines, customer, warehouse: 5 });
assert.equal(signature, buildAvailabilitySignature({ lines: [...orderLines].reverse(), customer, warehouse: 5 }), "la firma è indipendente dall'ordine delle righe");
const checked = { warehouse: 5, signature, lines: [{ productCode: "IT001", requestedQuantity: 10, confirmedQuantity: 6, missingQuantity: 4, status: "partial" }, { productCode: "IT002", requestedQuantity: 2, confirmedQuantity: 2, missingQuantity: 0, status: "available" }] };
assert.equal(getAvailabilityValidity({ availability: checked, lines: orderLines, customer }).valid, true, "una verifica completa e identica consente la conferma");
assert.equal(getAvailabilityValidity({ availability: null, lines: orderLines, customer }).valid, false, "la conferma è bloccata senza verifica");
assert.equal(getAvailabilityValidity({ availability: checked, lines: [{ ...orderLines[0], quantita: 3 }, orderLines[1]], customer }).valid, false, "la conferma è bloccata dopo modifica quantità");
assert.equal(getAvailabilityValidity({ availability: checked, lines: orderLines, customer: { codice_cliente: "C-02" } }).valid, false, "la conferma è bloccata dopo cambio cliente");
assert.equal(getAvailabilityValidity({ availability: { ...checked, lines: [{ ...checked.lines[0], status: "error" }, checked.lines[1]] }, lines: orderLines, customer }).valid, false, "una riga errore blocca la conferma");
assert.deepEqual(quantitiesForOrderLine(orderLines[1], checked, true), { quantita_disponibile: 6, quantita_ocm: 6, quantita_ocx: 4, quantita_oci: 0 }, "la conferma usa solamente il risultato puntuale, non disponibilita cache");
assert.deepEqual(quantitiesForOrderLine(orderLines[1], null, false), { quantita_disponibile: 10, quantita_ocm: 10, quantita_ocx: 0, quantita_oci: 0 }, "una bozza può usare il dato indicativo cache");
assert.deepEqual(quantitiesForOrderLine({ codice_articolo: " imp0012 ", quantita: 3 }, null, true), { quantita_disponibile: 0, quantita_ocm: 0, quantita_ocx: 0, quantita_oci: 3 }, "IMP bypasses warehouse allocation and retains the ordered OCI quantity");

const endpoint = await readFile("api/mexal/orders/check-availability.js", "utf8");
assert.match(endpoint, /verifyUser\(req, supabase, \{ allowOrdersUser: true \}\)/, "autenticazione e autorizzazione Ordini lato server");
assert.match(endpoint, /loadFullArticle\(mexal, productCode\)/, "usa lookup articolo puntuale");
assert.doesNotMatch(endpoint, /getAllArticles|\.from\("prodotti"\)/, "non avvia sync globale né scrive prodotti");
assert.doesNotMatch(endpoint, /MEXAL_PASSWORD.*json|MEXAL_USERNAME.*json/, "non espone credenziali nella risposta");

const frontend = await readFile("src/modules/orders/pages/NewOrder.jsx", "utf8");
assert.match(frontend, /VERIFICA DISPONIBILITÀ/);
assert.match(frontend, /disabled=\{checkingAvailability\}/);
assert.match(frontend, /Le disponibilità devono essere verificate nuovamente/);
assert.match(frontend, /confirm && !availabilityValidity\.valid/, "saveOrder blocca la conferma senza verifica valida");
assert.match(frontend, /disabled=\{saving \|\| checkingAvailability \|\| !availabilityValidity\.valid\}/, "il pulsante conferma è disabilitato senza verifica valida");
assert.match(frontend, /quantitiesForOrderLine\(line, availability, confirm\)/, "il payload confermato deriva dai risultati Mexal");
assert.match(frontend, /availabilityRequestId\.current/, "risposte obsolete non sovrascrivono la verifica corrente");
const submitOrder = await readFile("api/mexal/submit-order.js", "utf8");
assert.doesNotMatch(submitOrder, /quantita_ocm.*disponibilita|quantita_ocx.*disponibilita/, "submit-order usa le quantità OCM/OCX persistite senza ricalcolo cache");
console.log("order availability: validation, calculations, concurrency, preview, endpoint and UI safeguards verified");
