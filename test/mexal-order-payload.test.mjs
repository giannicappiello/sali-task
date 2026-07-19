import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildMexalOrderPayload, MEXAL_ORDER_HEADER_FIELDS, MEXAL_ORDER_ROW_FIELDS } from "../api/mexal/mexal-order-payload.js";
import { MexalHttpError } from "../api/mexal/submit-order.js";

const order = { id: "workspace-42", codice_cliente: "CLI001", data_ordine: "2026-07-19", codice_pagamento: "RIBA", codice_agente_mexal: "AG01", note_mexal: "Workspace n. workspace-42" };
const lines = [
  { codice_articolo: "A1", descrizione: "Disponibile", quantita_ocm: 2, quantita_ocx: 0, prezzo_netto: 12.5, sconto_commerciale: "10", sconto_pagamento: "2", unita_misura: "PZ" },
  { codice_articolo: "A2", descrizione: "Mancante", quantita_ocm: 0, quantita_ocx: 3, prezzo_netto: 9, sconto_commerciale: "", unita_misura: "CF" },
];
const config = { serie_ocm: "M", serie_ocx: "X" };

const ocm = buildMexalOrderPayload(order, lines, "OCM", config);
const ocx = buildMexalOrderPayload(order, lines, "OCX", config);
assert.deepEqual(ocm, { sigla: "OC", serie: "M", conto: "CLI001", data_documento: "2026-07-19", codice_pagamento: "RIBA", codice_agente: "AG01", righe: [{ articolo: "A1", descrizione: "Disponibile", quantita: 2, prezzo: 12.5, sconto: "10", unita_misura: "PZ" }] });
assert.deepEqual(ocx, { sigla: "OC", serie: "X", conto: "CLI001", data_documento: "2026-07-19", codice_pagamento: "RIBA", codice_agente: "AG01", righe: [{ articolo: "A2", descrizione: "Mancante", quantita: 3, prezzo: 9, unita_misura: "CF" }] });
for (const payload of [ocm, ocx]) {
  assert.deepEqual(Object.keys(payload).filter((key) => key !== "righe").sort(), [...MEXAL_ORDER_HEADER_FIELDS].sort());
  assert.ok(payload.righe.every(({ quantita }) => quantita > 0));
  assert.ok(payload.righe.every((row) => Object.keys(row).every((key) => MEXAL_ORDER_ROW_FIELDS.includes(key))));
  assert.doesNotMatch(JSON.stringify(payload), /note|codice_cliente|codice_articolo|prezzo_netto|sconto_pagamento/);
}
assert.equal(buildMexalOrderPayload(order, [{ ...lines[0], quantita_ocm: 0, quantita_ocx: 0 }], "OCM", config), null);
const error = new MexalHttpError(400, { error: { "response-detail": "6001 - errore gestionale" } }, "");
assert.equal(error.status, 400);
assert.deepEqual(error.response, { error: { "response-detail": "6001 - errore gestionale" } });
const submitSource = await readFile(new URL("../api/mexal/submit-order.js", import.meta.url), "utf8");
assert.match(submitSource, /!req\.body\?\.force && order\.stato_sincronizzazione === "completato"/, "un ordine già completato non viene rinviato");
assert.match(submitSource, /risposta: error\.response \|\| \{\}/, "l'errore HTTP conserva la risposta Mexal completa");
console.log("Mexal order payload uses the documented allow-list, quantity split, and captures HTTP errors");
