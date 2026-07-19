import assert from "node:assert/strict";
import { customerOrderSeriesOptions } from "../src/components/documentSeriesOptions.js";

const options = customerOrderSeriesOptions([
  { serie: "1", tipo_documento: "OC", descrizione: "Ordini cliente" },
  { serie: "2", tipo_documento: "OCM", descrizione: "Ordini cliente" },
  { serie: "3", sigla_documento: "OCX", descrizione: "Ordini export" },
  { serie: "4", descrizione: "Ordini cliente" },
  { serie: "5", tipo_documento: "FT", descrizione: "Fatture" },
]);
assert.deepEqual(options.map(({ serie }) => serie), ["1", "2", "3", "4"]);
assert.equal(options.some(({ serie }) => serie === "1"), true, "OC disponibile per OCM");
assert.equal(options.some(({ serie }) => serie === "1"), true, "OC disponibile per OCX");
console.log("document-series options: ok");
