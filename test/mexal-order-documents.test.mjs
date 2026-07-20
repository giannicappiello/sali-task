import assert from "node:assert/strict";
import { buildMexalOrderDocument, classifyOrderLines, isImportArticle } from "../server/mexal/order-documents.js";

const lines = [
  { codice_articolo: " IT0058 ", quantita: 12, quantita_ocm: 8, quantita_ocx: 4, prezzo_netto: 10 },
  { codice_articolo: "IT0204", quantita: 6, quantita_ocm: 0, quantita_ocx: 6 },
  { codice_articolo: " imp0012 ", quantita: 3, quantita_ocm: 3, quantita_ocx: 0 },
];
const classified = classifyOrderLines(lines);
assert.equal(isImportArticle(lines[2]), true, "IMP uses trimmed, case-insensitive article code");
assert.deepEqual(classified.OCI.map((line) => [line.codice_articolo, line.quantita_documento]), [[" imp0012 ", 3]], "IMP is sent only to OCI at ordered quantity");
assert.deepEqual(classified.OCM.map((line) => line.codice_articolo), [" IT0058 "], "IMP never enters OCM");
assert.deepEqual(classified.OCX.map((line) => [line.codice_articolo, line.quantita_documento]), [[" IT0058 ", 4], ["IT0204", 6]], "non-IMP partial stock is split");

const payload = buildMexalOrderDocument({ id: "workspace-1", codice_cliente: "C1", data_ordine: "2026-07-20", note_mexal: "nota test", id_pagamento: 7 }, "OCI", classified.OCI, { notaFormat: "typed-array", linesField: "dettaglio", serie: 2, magazzino: 5 });
assert.deepEqual(payload, { sigla: "OC", serie: 2, numero: 0, cod_conto: "C1", data_documento: "2026-07-20", cod_modulo: "I", id_magazzino: 5, nota: [[1, "nota test"]], id_pagamento: 7, dettaglio: [{ codice_articolo: "IMP0012", quantita: 3, id_mag_riga: 5 }] });
for (const forbidden of ["note", "conto", "codice_pagamento", "articolo", "prezzo_netto", "righe"]) assert.equal(JSON.stringify(payload).includes(`\"${forbidden}\"`), false, `${forbidden} is never a direct WebAPI key`);
assert.throws(() => buildMexalOrderDocument({}, "OCI", classified.OCI, { notaFormat: "scalar" }), /LINES_FIELD/);
assert.equal(buildMexalOrderDocument({}, "OCM", [], { notaFormat: "scalar", linesField: "dettaglio" }), null, "empty documents are not generated");
console.log("mexal order documents: OCI classification, write payload, and OCM/OCX split verified");
