import assert from "node:assert/strict";
import { customerOrderSeriesOptions } from "../src/components/documentSeriesOptions.js";

const options = customerOrderSeriesOptions([
  { source_key: "OC:1", serie: "1", sigla_documento: "OC", tipo_documento: "OC", descrizione: "Documento OC - Serie 1" },
  { source_key: "OX:3", serie: "3", sigla_documento: "OX", tipo_documento: "OX", descrizione: "Documento OX - Serie 3" },
  { serie: "4", descrizione: "Ordini cliente" },
  { serie: "5", tipo_documento: "FT", descrizione: "Fatture" },
]);
assert.deepEqual(options.map(({ source_key }) => source_key), ["OC:1", "OX:3", undefined]);
assert.equal(options.some(({ sigla_documento }) => sigla_documento === "OC"), true, "OC disponibile per OCM e OCX");
assert.equal(options.some(({ sigla_documento }) => sigla_documento === "OX"), true, "OX disponibile per OCM e OCX");
console.log("document-series options: ok");
