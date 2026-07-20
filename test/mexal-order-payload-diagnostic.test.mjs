import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { compareMexalPayloads } from "../scripts/mexal-diagnose-order.mjs";

const result = compareMexalPayloads(
  { data_documento: "20/07/2026", Cod_Conto: "C1", only_get: 1, nested: { value: "20260720" } },
  { data_documento: [[1, "20/07/2026"]], cod_conto: "C1", only_post: true, nested: { value: "2026-07-20" } },
);

assert.deepEqual(result.missing_fields, [{ path: "$.only_get", get_type: "number" }]);
assert.deepEqual(result.additional_fields, [{ path: "$.only_post", post_type: "boolean" }]);
assert.deepEqual(result.type_differences, [{ path: "$.data_documento", get_type: "string", post_type: "array" }]);
assert.deepEqual(result.format_differences, [{ path: "$.nested.value", get_format: "date-yyyymmdd", post_format: "date-yyyy-mm-dd" }]);
assert.deepEqual(result.nomenclature_differences, [{ path: "$", get_field: "Cod_Conto", post_field: "cod_conto" }]);

const script = await readFile("scripts/mexal-diagnose-order.mjs", "utf8");
assert.match(script, /getJson\(resource\)/, "la diagnostica esegue il GET Mexal");
assert.doesNotMatch(script, /postJson\(/, "la diagnostica non esegue POST Mexal");
assert.match(script, /diagnostics["'], ["']mexal/, "il risultato viene salvato localmente");

console.log("mexal order payload diagnostic: local GET snapshot and structural comparison verified");
