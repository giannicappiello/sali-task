import assert from "node:assert/strict";
import { extractRows, inspectPayload, prepareDocumentSeries, prepareRows } from "../server/mexal/sync-document-series.js";

const payload = {
  dati: [
    { sigla_documento: "FF", serie_massima: 5, descrizione: [[1, "ORDINARIE"], [2, "ESTERE"]] },
    { sigla_documento: "OC", serie_massima: 5, descrizione: [] },
    { sigla_documento: "OX", serie_massima: "2", descrizione: "malformata" },
    { sigla_documento: "ZZ", serie_massima: 0, descrizione: [] },
    { serie_massima: 2, descrizione: [] },
  ],
};
const prepared = prepareDocumentSeries(payload);
assert.equal(extractRows(payload).length, 4, "legge prioritariamente il wrapper dati");
assert.equal(prepared.received_documents, 5);
assert.equal(prepared.generated_series, 12, "espande OC 1..5, FF 1..5 e OX 1..2");
assert.equal(prepared.rows.filter((row) => row.sigla_documento === "OC").length, 5, "OC serie_massima 5 genera cinque righe");
assert.equal(prepared.rows.find((row) => row.source_key === "FF:1").descrizione, "ORDINARIE");
assert.equal(prepared.rows.find((row) => row.source_key === "FF:2").descrizione, "ESTERE");
assert.equal(prepared.rows.find((row) => row.source_key === "FF:3").descrizione, "Documento FF - Serie 3", "fallback descrizione");
assert.equal(prepared.rows.find((row) => row.source_key === "OX:1").serie, "1", "serie_massima stringa numerica");
assert.equal(prepared.rows.some((row) => row.sigla_documento === "ZZ"), false, "serie_massima zero non genera righe");
assert.equal(prepared.skipped_documents.length, 2, "zero e sigla mancante sono skipped");
const ff = prepared.rows.find((row) => row.source_key === "FF:1");
assert.deepEqual(Object.keys(ff).sort(), ["attiva", "codice_univoco", "dati_mexal", "descrizione", "serie", "sigla_documento", "sincronizzata_il", "source_key", "tipo_documento"].sort());
assert.equal(ff.codice_univoco, "FF:1");
assert.equal(ff.tipo_documento, "FF");
assert.equal(ff.attiva, true);
assert.equal(ff.dati_mexal.numero_serie, 1);
assert.equal(ff.dati_mexal.descrizione_originale, "ORDINARIE");
assert.equal(prepareRows({ dati: [{ sigla_documento: "OC", serie_massima: 1 }, { sigla_documento: "OC", serie_massima: 1 }] }).length, 1, "deduplica source_key prima dell'upsert");

const diagnostics = inspectPayload({ token: "never-show", ...payload }, "https://mexal.example/webapi/risorse/dati-generali/serie-documenti", 200);
assert.deepEqual(Object.keys(diagnostics).sort(), ["arrays_found", "candidate_paths", "detected_document_signatures", "document_count", "endpoint", "generated_series_count", "http_status", "payload_type", "root_keys", "sample_shape", "skipped_documents"].sort());
assert.equal(diagnostics.document_count, 5);
assert.deepEqual(diagnostics.detected_document_signatures, ["FF", "OC", "OX", "ZZ"]);
assert.equal("candidates" in diagnostics, false, "diagnostica pubblica senza payload completo");
assert.equal("token" in diagnostics.sample_shape.root_scalar_values, false, "diagnostica redatta");
console.log("document-series parser and diagnostics: ok");
