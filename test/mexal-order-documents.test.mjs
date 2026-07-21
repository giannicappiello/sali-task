import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DEFAULT_MEXAL_ORDER_DATE_FORMAT, buildMexalOrderDocument, classifyOrderLines, formatMexalOrderDate, isImportArticle } from "../server/mexal/order-documents.js";
import { documentOptions } from "../api/mexal/submit-order.js";

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
assert.deepEqual(payload, { sigla: "OC", serie: 2, numero: 0, cod_conto: "C1", data_documento: [[1, "20/07/2026"]], cod_modulo: "X", id_magazzino: 5, nota: [[1, "nota test"]], id_pagamento: 7, id_riga: [[1, 1], [2, 2]], tp_riga: [[1, "R"], [2, "R"]], codice_articolo: [[1, "IT0058"], [2, "IT0204"]], quantita: [[1, 4], [2, 6]], prezzo: [[1, 15.68], [2, 12]], sconto: [[1, "50+35"], [2, "50+35"]], id_mag_riga: [[1, 5], [2, 5]], tp_um_articolo: [[1, "1"], [2, "1"]], cod_iva: [[1, "22,0"], [2, "22,0"]] });
const ocmPayload = buildMexalOrderDocument({ id: "workspace-1", codice_cliente: "C1", data_ordine: "2026-07-20" }, "OCM", classified.OCM, { dateFormat: "typed-array-dd/mm/yyyy" });
assert.deepEqual(ocmPayload.data_documento, [[1, "20/07/2026"]], "OCM sends data_documento as the required typed matrix");
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
assert.doesNotMatch(submitOrderSource, /ordini_testate"\)\.update\(\{\s*stato:/, "Mexal finalization never changes the commercial order state");
assert.match(submitOrderSource, /stato_sincronizzazione: "errore", errore_sincronizzazione: error\.message[\s\S]*sincronizzato_mexal_il: null[\s\S]*sync_token: null/, "error finalization records the failure and clears its sync lease without changing stato");
assert.match(mexalClientSource, /onDiagnostic\?\.\(\{ phase: "request", url, method: "POST", headers: requestHeaders, body \}\)/, "the exact serialized request is logged immediately before POST");
assert.match(mexalClientSource, /onDiagnostic\?\.\(\{ phase: "response", url, method: "POST", status: response\.status, headers: response\.headers, body: response\.body \}\)/, "the full Mexal HTTP response is logged before status parsing");
console.log("mexal order documents: OCI classification, write payload, OCM/OCX split, and date formatting verified");
