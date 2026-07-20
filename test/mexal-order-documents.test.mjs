import assert from "node:assert/strict";
import { buildMexalOrderDocument, classifyOrderLines, formatMexalDocumentDate, isImportArticle } from "../server/mexal/order-documents.js";

const lines = [
  { codice_articolo: " IT0058 ", quantita: 12, quantita_ocm: 8, quantita_ocx: 4, prezzo_netto: 15.68, sconto_commerciale: "50+35", unita_misura: "1", cod_iva: " 22,0" },
  { codice_articolo: "IT0204", quantita: 6, quantita_ocm: 0, quantita_ocx: 6, prezzo_netto: 12, sconto_commerciale: "50+35", unita_misura: "1", cod_iva: " 22,0" },
  { codice_articolo: " imp0012 ", quantita: 3, quantita_ocm: 3, quantita_ocx: 0 },
];
const classified = classifyOrderLines(lines);
assert.equal(isImportArticle(lines[2]), true, "IMP uses trimmed, case-insensitive article code");
assert.deepEqual(classified.OCI.map((line) => [line.codice_articolo, line.quantita_documento]), [[" imp0012 ", 3]], "IMP is sent only to OCI at ordered quantity");
assert.deepEqual(classified.OCM.map((line) => line.codice_articolo), [" IT0058 "], "IMP never enters OCM");
assert.deepEqual(classified.OCX.map((line) => [line.codice_articolo, line.quantita_documento]), [[" IT0058 ", 4], ["IT0204", 6]], "non-IMP partial stock is split");

const payload = buildMexalOrderDocument({ id: "workspace-1", codice_cliente: "C1", data_ordine: "2026-07-20", note_mexal: "nota test", id_pagamento: 7 }, "OCX", classified.OCX, { serie: 2, magazzino: 5 });
assert.equal(formatMexalDocumentDate("2026-07-20"), "20/07/2026");
assert.equal(formatMexalDocumentDate("2026-07-20", "yyyymmdd"), "20260720");
assert.deepEqual(formatMexalDocumentDate("2026-07-20", "typed-array-dd/mm/yyyy"), [[1, "20/07/2026"]]);
assert.throws(() => formatMexalDocumentDate("2026-02-30"), /non valida/);
assert.throws(() => formatMexalDocumentDate(null), /obbligatoria/);
assert.deepEqual(payload, { sigla: "OC", serie: 2, numero: 0, cod_conto: "C1", data_documento: "20/07/2026", cod_modulo: "X", id_magazzino: 5, nota: [[1, "nota test"]], id_pagamento: 7, codice_articolo: [[1, "IT0058"], [2, "IT0204"]], quantita: [[1, 4], [2, 6]], prezzo: [[1, 15.68], [2, 12]], sconto: [[1, "50+35"], [2, "50+35"]], id_mag_riga: [[1, 5], [2, 5]], tp_um_articolo: [[1, "1"], [2, "1"]], cod_iva: [[1, "22,0"], [2, "22,0"]] });
assert.equal("data_documento" in payload, true, "payload always includes formatted data_documento");
for (const forbidden of ["note", "conto", "codice_pagamento", "articolo", "prezzo_netto", "righe"]) assert.equal(JSON.stringify(payload).includes(`\"${forbidden}\"`), false, `${forbidden} is never a direct WebAPI key`);
assert.equal(buildMexalOrderDocument({}, "OCM", [], { notaFormat: "scalar" }), null, "empty documents are not generated");
console.log("mexal order documents: OCI classification, write payload, and OCM/OCX split verified");
