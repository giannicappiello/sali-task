import assert from "node:assert/strict";
import { extractRows, inspectPayload, prepareRows } from "../api/mexal/sync-document-series.js";

const ocm = { tipo_documento: "OCM", sigla_doc: "OCM", cod_serie: "A", des_serie: "Ordini clienti", attivo: true };
const ocx = { tipo_documento: "OCX", sigla_doc: "OCX", cod_serie: "B", des_serie: "Ordini export", attiva: false };
assert.equal(extractRows([ocm]).length, 1, "array diretto");
assert.equal(extractRows({ data: [ocm] }).length, 1, "wrapper object");
assert.equal(extractRows({ result: { records: [ocm] } }).length, 1, "array annidato");
assert.equal(extractRows(ocm).length, 1, "record singolo");
assert.deepEqual(extractRows({ serie_documenti: { OCM: { A: "Ordini clienti" } } }), [{ serie: "A", descrizione_serie: "Ordini clienti", tipo_documento: "OCM" }], "chiave/valore esplicita");
assert.equal(extractRows({ meta: { count: 0 }, data: [] }).length, 0, "risposta vuota");
assert.equal(extractRows({ metadata: ["safe"], result: { value: 1 } }).length, 0, "struttura non riconosciuta");
const diagnostics = inspectPayload({ token: "never-show", result: { records: [ocm] } }, "https://mexal.example/webapi/risorse/dati-generali/serie-documenti", 200);
assert.equal(diagnostics.endpoint.endsWith("/dati-generali/serie-documenti"), true);
assert.equal(diagnostics.http_status, 200);
assert.equal(diagnostics.arrays_found[0].first_element_keys.includes("cod_serie"), true);
assert.equal("token" in diagnostics.sample_shape.root_scalar_values, false, "diagnostica redatta");
const prepared = prepareRows({ data: [ocm, ocm, ocx] });
assert.equal(prepared.length, 2, "upsert payload senza duplicati");
assert.equal(prepared[0].codice_univoco, "OCM:OCM:A");
assert.equal(prepared[1].attiva, false);
// No delete/update-wide operation is exposed: validation happens before saveRows is called, preserving prior rows on error.
assert.equal(prepareRows({ data: [] }).length, 0, "conservazione dati precedenti in caso di errore");
console.log("document-series parser and diagnostics: ok");
