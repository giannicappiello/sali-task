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
import { buildAvailabilityPreview } from "../src/modules/orders/services/availability.js";

assert.throws(() => normalizeLines([]), /obbligatorio/);
assert.throws(() => normalizeLines([{ productCode: "IT1", quantity: 0 }]), /Quantità non valida/);
assert.throws(() => normalizeLines([{ quantity: 1 }]), /Codice prodotto obbligatorio/);
assert.throws(() => normalizeLines(Array.from({ length: MAX_ORDER_LINES + 1 }, () => ({ productCode: "IT1", quantity: 1 }))), /al massimo/);
assert.deepEqual(normalizeLines([{ codice_articolo: " it 001 ", quantita: 2 }, { productCode: "IT001", quantity: 3 }]), [{ productCode: "IT001", requestedQuantity: 5 }]);

const article = { codice: "IT001", qta_inventario: 8, qta_carico: 0, qta_scarico: 0, ord_cli_e: 2 };
assert.deepEqual(availabilityLine("IT001", 10, article), { productCode: "IT001", requestedQuantity: 10, availableQuantity: 6, confirmedQuantity: 6, missingQuantity: 4, status: "partial", message: null });
assert.equal(availabilityLine("IT001", 4, article).status, "available");
assert.equal(availabilityLine("IT001", 4, { codice: "IT001" }).status, "unavailable");
const summary = summarize([availabilityLine("IT001", 10, article), availabilityLine("IT002", 4, { codice: "IT002" }), { productCode: "IT003", requestedQuantity: 3, confirmedQuantity: 0, missingQuantity: 3, status: "error" }]);
assert.deepEqual(summary, { totalLines: 3, availableLines: 0, partialLines: 1, unavailableLines: 1, errorLines: 1, requestedQuantity: 17, confirmedQuantity: 6, missingQuantity: 11 });

let active = 0; let peak = 0;
await mapWithConcurrency(Array.from({ length: 20 }, (_, index) => index), AVAILABILITY_CONCURRENCY, async (value) => { active += 1; peak = Math.max(peak, active); await new Promise((resolve) => setTimeout(resolve, 2)); active -= 1; return value; });
assert.ok(peak <= AVAILABILITY_CONCURRENCY && peak > 1, "le richieste sono limitate ma concorrenti");

assert.deepEqual(buildAvailabilityPreview([{ codice_articolo: "IT001", descrizione: "Articolo" }], [{ productCode: "IT001", requestedQuantity: 10, confirmedQuantity: 6, missingQuantity: 4 }]), { ocm: [{ productCode: "IT001", description: "Articolo", requestedQuantity: 10, quantity: 6 }], ocx: [{ productCode: "IT001", description: "Articolo", requestedQuantity: 10, quantity: 4 }] });

const endpoint = await readFile("api/mexal/orders/check-availability.js", "utf8");
assert.match(endpoint, /verifyUser\(req, supabase, \{ allowOrdersUser: true \}\)/, "autenticazione e autorizzazione Ordini lato server");
assert.match(endpoint, /loadFullArticle\(mexal, productCode\)/, "usa lookup articolo puntuale");
assert.doesNotMatch(endpoint, /getAllArticles|\.from\("prodotti"\)/, "non avvia sync globale né scrive prodotti");
assert.doesNotMatch(endpoint, /MEXAL_PASSWORD.*json|MEXAL_USERNAME.*json/, "non espone credenziali nella risposta");

const frontend = await readFile("src/modules/orders/pages/NewOrder.jsx", "utf8");
assert.match(frontend, /VERIFICA DISPONIBILITÀ/);
assert.match(frontend, /disabled=\{checkingAvailability\}/);
assert.match(frontend, /Le disponibilità devono essere verificate nuovamente/);
console.log("order availability: validation, calculations, concurrency, preview, endpoint and UI safeguards verified");
