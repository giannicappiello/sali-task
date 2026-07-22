import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DEFAULT_MEXAL_ORDER_DATE_FORMAT, buildMexalOrderDocument, classifyOrderLines, formatMexalOrderDate, isImportArticle } from "../server/mexal/order-documents.js";
import { documentOptions, extractDocumentReference } from "../api/mexal/submit-order.js";
import { buildMexalClient } from "../server/mexal/sync-products.js";

assert.deepEqual(extractDocumentReference({ risorsa: "OC+3+125" }), { serie: "3", numero: "125" }, "the real Mexal resource reference is split into series and number");
assert.deepEqual(extractDocumentReference({ documento: { serie: 4, numero: 99 } }), { serie: "4", numero: "99" }, "a document object response is supported");
assert.deepEqual(extractDocumentReference({ id: "f770a164-17e5-4508-b795-e28adf6f560b" }), { serie: null, numero: null }, "an internal UUID is never mistaken for a Mexal document number");

const originalMexalEnv = Object.fromEntries(["MEXAL_BASE_URL", "MEXAL_USERNAME", "MEXAL_PASSWORD", "MEXAL_AZIENDA", "MEXAL_ANNO", "MEXAL_MAGAZZINO"].map((name) => [name, process.env[name]]));
Object.assign(process.env, { MEXAL_BASE_URL: "https://mexal.test", MEXAL_USERNAME: "user", MEXAL_PASSWORD: "password", MEXAL_AZIENDA: "1", MEXAL_ANNO: "2026", MEXAL_MAGAZZINO: "5" });
const postedBodies = [];
const mexalWithEmptyCreatedBody = buildMexalClient({
  request: async ({ body }) => {
    postedBodies.push(body);
    return { status: 201, headers: { location: "/documenti/ordini-clienti/OC+1+16530" }, body: "{}" };
  },
});
const createdDocument = await mexalWithEmptyCreatedBody.postJson("/documenti/ordini-clienti", { sigla: "OC" });
const savedReference = extractDocumentReference(createdDocument);
assert.deepEqual(savedReference, { serie: "1", numero: "16530" }, "an HTTP 201 with an empty body persists the series and number from Location");
assert.equal(Object.keys(createdDocument).includes("mexalHttpResponse"), false, "HTTP metadata does not alter the legacy JSON response body");
for (const [name, value] of Object.entries(originalMexalEnv)) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

const lines = [
  { codice_articolo: " IT0058 ", quantita: 12, quantita_ocm: 8, quantita_ocx: 4, prezzo_listino: 15.68, sconto_commerciale: "50+35", unita_misura: "1", cod_iva: " 22,0" },
  { codice_articolo: "IT0204", quantita: 6, quantita_ocm: 0, quantita_ocx: 6, prezzo_listino: 12, sconto_commerciale: "50+35", unita_misura: "1", cod_iva: " 22,0" },
  { codice_articolo: " imp0012 ", quantita: 3, quantita_ocm: 3, quantita_ocx: 0 },
];
const classified = classifyOrderLines(lines);
assert.equal(isImportArticle(lines[2]), true, "IMP uses trimmed, case-insensitive article code");
assert.deepEqual(classified.OCI.map((line) => [line.codice_articolo, line.quantita_documento]), [[" imp0012 ", 3]], "IMP is sent only to OCI at ordered quantity");
assert.deepEqual(classified.OCM.map((line) => line.codice_articolo), [" IT0058 "], "IMP never enters OCM");
assert.deepEqual(classified.OCX.map((line) => [line.codice_articolo, line.quantita_documento]), [[" IT0058 ", 4], ["IT0204", 6]], "non-IMP partial stock is split");

const payload = buildMexalOrderDocument({ id: "workspace-1", codice_cliente: "C1", data_ordine: "2026-07-20", note_mexal: "nota test", id_pagamento: 7 }, "OCX", classified.OCX, { serie: 2, magazzino: 5, dateFormat: "typed-array-dd/mm/yyyy" });
// These fields are existing buildMexalOrderDocument defaults, not commission behavior.
assert.deepEqual(payload, { sigla: "OC", serie: 2, numero: 0, cod_conto: "C1", data_documento: [[1, "20/07/2026"]], cod_modulo: "X", id_causale: [[1, 1]], id_magazzino: 5, nota: [[1, "nota test"]], id_pagamento: 7, id_riga: [[1, 1], [2, 2]], tp_riga: [[1, "R"], [2, "R"]], codice_articolo: [[1, "IT0058"], [2, "IT0204"]], quantita: [[1, 4], [2, 6]], prezzo: [[1, 15.68], [2, 12]], sconto: [[1, "50+35"], [2, "50+35"]], id_mag_riga: [[1, 5], [2, 5]], tp_um_articolo: [[1, "1"], [2, "1"]], cod_iva: [[1, "22,0"], [2, "22,0"]], tipo_stato_riga: [[1, "S"], [2, "S"]] });
const ocmPayload = buildMexalOrderDocument({ id: "workspace-1", codice_cliente: "C1", data_ordine: "2026-07-20" }, "OCM", classified.OCM, { dateFormat: "typed-array-dd/mm/yyyy" });
assert.deepEqual(ocmPayload.data_documento, [[1, "20/07/2026"]], "OCM sends data_documento as the required typed matrix");
assert.deepEqual(ocmPayload.tipo_stato_riga, [[1, "E"]], "OCM product rows remain evadibile");
const ociPayload = buildMexalOrderDocument({ id: "workspace-1", codice_cliente: "C1", data_ordine: "2026-07-20" }, "OCI", classified.OCI, { dateFormat: "typed-array-dd/mm/yyyy" });
assert.deepEqual(ociPayload.tipo_stato_riga, [[1, "S"]], "OCI product rows are suspended");
assert.deepEqual(payload.tipo_stato_riga, [[1, "S"], [2, "S"]], "OCX product rows are suspended");
await Promise.all([ocmPayload, payload, ociPayload].map((document) => mexalWithEmptyCreatedBody.postJson("/documenti/ordini-clienti", document)));
assert.deepEqual(postedBodies.slice(1).map((body) => Object.hasOwn(JSON.parse(body), "stato_riga")), [false, false, false], "OCM, OCX, and OCI POST payloads omit the rejected stato_riga field");
const splitLine = { codice_articolo: "IT-SPLIT", quantita: 10, quantita_ocm: 6, quantita_ocx: 4, prezzo_listino: 1, cod_iva: "22,0" };
const splitDocuments = classifyOrderLines([splitLine]);
for (const kind of ["OCM", "OCX", "OCI"]) assert.equal(Object.hasOwn(buildMexalOrderDocument({ codice_cliente: "C1", data_ordine: "2026-07-20" }, kind, splitDocuments[kind]?.length ? splitDocuments[kind] : classified[kind]), "stato_riga"), false, `${kind} document payload omits the rejected row-state field`);
for (const forbidden of ["note", "conto", "codice_pagamento", "articolo", "prezzo_netto", "righe"]) assert.equal(JSON.stringify(payload).includes(`\"${forbidden}\"`), false, `${forbidden} is never a direct WebAPI key`);
assert.equal(buildMexalOrderDocument({}, "OCM", [], { notaFormat: "scalar" }), null, "empty documents are not generated");
assert.equal(DEFAULT_MEXAL_ORDER_DATE_FORMAT, "yyyymmdd", "the shared date format default remains unchanged");
assert.equal(formatMexalOrderDate("2026-07-20"), "20260720", "the default Mexal date format remains unchanged");
assert.equal(formatMexalOrderDate("2026-07-20", "yyyymmdd"), "20260720", "compact date format is supported");
assert.equal(formatMexalOrderDate("2026-07-20", "iso"), "2026-07-20", "ISO date format is supported");
assert.deepEqual(formatMexalOrderDate("2026-07-20", "typed-array-dd/mm/yyyy"), [[1, "20/07/2026"]], "typed-array Italian date format is supported");
const originalDateFormat = process.env.MEXAL_ORDER_DATE_FORMAT;
delete process.env.MEXAL_ORDER_DATE_FORMAT;
assert.equal(documentOptions({}, "OCM").dateFormat, "yyyymmdd", "unset environment uses the shared date-format default");
process.env.MEXAL_ORDER_DATE_FORMAT = "iso";
assert.equal(documentOptions({}, "OCM").dateFormat, "iso", "explicit MEXAL_ORDER_DATE_FORMAT overrides the default");
if (originalDateFormat === undefined) delete process.env.MEXAL_ORDER_DATE_FORMAT;
else process.env.MEXAL_ORDER_DATE_FORMAT = originalDateFormat;
assert.throws(() => formatMexalOrderDate("20/07/2026"), /YYYY-MM-DD/, "dates must use strict ISO input syntax");
assert.throws(() => formatMexalOrderDate("2026-02-29"), /YYYY-MM-DD/, "dates must be valid calendar dates");
assert.throws(() => formatMexalOrderDate("2026-07-20", "invalid"), /MEXAL_ORDER_DATE_FORMAT/, "unsupported date formats are rejected");
const submitOrderSource = await readFile("api/mexal/submit-order.js", "utf8");
const mexalClientSource = await readFile("server/mexal/sync-products.js", "utf8");
assert.match(submitOrderSource, /logMexalOrderDiagnostic[\s\S]*?dateFields[\s\S]*?\/data\|date\/i/, "order POST diagnostics highlight every date-like payload field");
assert.match(submitOrderSource, /postJson\("\/documenti\/ordini-clienti", payload, \{ onDiagnostic \}\)/, "order submission forwards HTTP diagnostics from the Mexal client");
assert.match(submitOrderSource, /finalizeOrderError[\s\S]*?if \(!finalizedOrder\) throw/, "a failed final order-state update is no longer silently ignored");
assert.doesNotMatch(submitOrderSource, /statoRigaMexal|mexalLineState/, "order submission does not reintroduce a speculative row-state mapping");
assert.doesNotMatch(submitOrderSource, /ordini_testate"\)\.update\(\{\s*stato:/, "Mexal finalization never changes the commercial order state");
assert.match(submitOrderSource, /stato_sincronizzazione: "errore", errore_sincronizzazione: error\.message[\s\S]*sincronizzato_mexal_il: null[\s\S]*sync_token: null/, "error finalization records the failure and clears its sync lease without changing stato");
assert.match(mexalClientSource, /onDiagnostic\?\.\(\{ phase: "request", url, method: "POST", headers: requestHeaders, body \}\)/, "the exact serialized request is logged immediately before POST");
assert.match(mexalClientSource, /onDiagnostic\?\.\(\{ phase: "response", url, method: "POST", status: response\.status, headers: response\.headers, body: response\.body \}\)/, "the full Mexal HTTP response is logged before status parsing");
console.log("mexal order documents: OCI classification, write payload, OCM/OCX split, line statuses, and date formatting verified");
