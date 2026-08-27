import assert from "node:assert/strict";
import test from "node:test";
import { requestStage, resolveWorkbenchOctUnit, resolveWorkbenchUnits } from "./workspacemes-workbench.js";

test("una RdP annullata è storico e non resta tra i bloccati", () => {
  assert.equal(requestStage({ workspace_status: "Cancelled" }), "history");
  assert.equal(requestStage({ workspace_status: "Blocked" }), "blocked");
});

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

test("il riepilogo Workbench non espone il codice tecnico 1 come una seconda UDM", () => {
  const products = new Map([["DR-BC07", { codice_articolo: "DR-BC07", unita_misura: "PZ" }]]);
  assert.deepEqual(resolveWorkbenchUnits([
    { codice_articolo: "DR-BC07", unita_misura_oct: "PZ" },
    { codice_articolo: "DR-BC07", unita_misura_oct: null, tipo_unita_misura_mexal: "1" },
  ], products), ["PZ"]);
});
