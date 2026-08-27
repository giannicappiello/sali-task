import assert from "node:assert/strict";
import test from "node:test";
import { activeOctLines, diagnosticBlocks, requestStage, resolveWorkbenchOctUnit, resolveWorkbenchUnits, workbenchDetailLines } from "./workspacemes-workbench.js";

test("una RdP annullata è storico e non resta tra i bloccati", () => {
  assert.equal(requestStage({ workspace_status: "Cancelled" }), "history");
  assert.equal(requestStage({ workspace_status: "Blocked" }), "blocked");
});

test("solo diagnostiche operative aperte bloccano una nuova RdP", () => {
  assert.equal(diagnosticBlocks({ severity: "Blocking", status: "Open" }), true);
  assert.equal(diagnosticBlocks({ severity: "Critical", status: "Acknowledged" }), true);
  assert.equal(diagnosticBlocks({ severity: "Blocking", status: "Resolved" }), false);
  assert.equal(diagnosticBlocks({ severity: "Blocking", status: "Archived" }), false);
});

test("il Workbench corrente nasconde le righe ritirate preservandole nel record sorgente", () => {
  const lines = [{ id: "current", mexal_attiva: true }, { id: "historical", mexal_attiva: false }];
  assert.deepEqual(activeOctLines(lines).map((line) => line.id), ["current"]);
  assert.equal(lines.length, 2);
});

test("il dettaglio RdP mostra righe attive e righe storiche appartenenti a quella RdP soltanto", () => {
  const lines = [
    { id: "current", mexal_attiva: true },
    { id: "retired-from-request", mexal_attiva: false },
    { id: "retired-from-old-request", mexal_attiva: false },
  ];
  const requestItems = [{ ordine_riga_id: "current" }, { ordine_riga_id: "retired-from-request" }];
  assert.deepEqual(workbenchDetailLines(lines, requestItems).map((line) => line.id), ["current", "retired-from-request"]);
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
