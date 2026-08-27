import assert from "node:assert/strict";
import test from "node:test";
import { resolveWorkbenchOctUnit } from "./workspacemes-workbench.js";

test("il tipo UDM Mexal 1 usa la UDM principale autorevole anche nel dettaglio Workbench", () => {
  assert.equal(resolveWorkbenchOctUnit(
    { unita_misura_oct: null, tipo_unita_misura_mexal: "1" },
    { unita_misura: "PZ", dati_mexal: { um_principale: "KG" } },
  ), "PZ");
});

test("l'UDM esplicita OCT prevale sul tipo numerico Mexal", () => {
  assert.equal(resolveWorkbenchOctUnit(
    { unita_misura_oct: "pz.", tipo_unita_misura_mexal: "1" },
    { unita_misura: "KG" },
  ), "PZ");
});
