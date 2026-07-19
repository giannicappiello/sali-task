import assert from "node:assert/strict";
import { extractRows, inspectPayload } from "../api/mexal/sync-document-series.js";
const row = { codice_serie: "A", descrizione_serie: "Ordini" };
for (const payload of [[row], { data: [row] }, { dati: [row] }, { result: { records: [row] } }, { outer: { serie: [row] } }, row]) {
  assert.equal(extractRows(payload).length, 1);
}
const diagnostics = inspectPayload({ metadata: ["safe"], result: { value: 1 } });
assert.equal(extractRows({ metadata: ["safe"] }).length, 0);
assert.equal(diagnostics.arrays_found[0].path, "$.metadata");
console.log("document-series parser: ok");
