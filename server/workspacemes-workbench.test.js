import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { activeOctLines, diagnosticBlocks, diagnosticMatchesWorkbenchLine, loadAllProductionOrders, rdpProductionState, requestStage, resolveWorkbenchOctUnit, resolveWorkbenchUnits, v2DecisionAvailability, visibleDiagnostic, workbenchBomComponent, workbenchDetailLines, workbenchLineMappingStatus } from "./workspacemes-workbench.js";

test("il dettaglio Workbench legge la data reale della revisione distinta", async () => {
  const source = await readFile(new URL("./workspacemes-workbench.js", import.meta.url), "utf8");
  assert.match(source, /workspace_finished_bom_revisions[\s\S]*unit_of_measure,effective_from/);
  assert.match(source, /capturedAt:\s*revision\.effective_from/);
  assert.doesNotMatch(source, /workspace_finished_bom_revisions[\s\S]{0,250}unit_of_measure,captured_at/);
});

test("una RdP annullata è storico e non resta tra i bloccati", () => {
  assert.equal(requestStage({ workspace_status: "Cancelled" }), "history");
  assert.equal(requestStage({ workspace_status: "Blocked" }), "blocked");
});

test("una RdP V4 confermata passa in pianificazione e non risulta già in produzione", () => {
  assert.equal(requestStage({ workspace_status: "CONFIRMED" }), "scheduling");
});

test("lo stato operativo segue il vero stato degli OdP ProgreMES", () => {
  const request = { workspace_status: "CONFIRMED", rdp_number: 16 };
  assert.equal(rdpProductionState(request, [{ numeroOrdine: "RDP16", stato: "Nuovo" }]).stage, "scheduling");
  const planned = rdpProductionState(request, [{ numeroOrdine: "RDP16", stato: "Pianificato", dataPrevistaConsegna: "2026-12-01T12:00:00Z" }]);
  assert.equal(planned.stage, "planned");
  assert.equal(planned.plannedCompletionDate, "2026-12-01T12:00:00.000Z");
  assert.equal(rdpProductionState(request, [{ numeroOrdine: "RDP16", stato: "InProduzione" }]).stage, "production");
});

test("gli OdP precedenti a V4 aggiornano l'OCT collegato", () => {
  const state = rdpProductionState(null, [{
    numeroOrdine: "OC/2/425-01",
    riferimentoOct: "OC/2/425",
    stato: "InProduzione",
  }], "OC / 2 / 425");
  assert.equal(state.stage, "production");
  assert.equal(state.status, "IN PRODUZIONE");
  assert.equal(state.orders.length, 1);
});

test("il Workbench carica tutte le pagine degli OdP MES", async () => {
  const calls = [];
  const client = { request: async (_resource, query) => {
    calls.push(query.page);
    return query.page === 1
      ? { page: 1, pageSize: 2, total: 3, items: [{ id: 1 }, { id: 2 }] }
      : { page: 2, pageSize: 2, total: 3, items: [{ id: 3 }] };
  } };
  const items = await loadAllProductionOrders(client, 2);
  assert.deepEqual(calls, [1, 2]);
  assert.deepEqual(items.map((item) => item.id), [1, 2, 3]);
});

test("solo diagnostiche operative aperte bloccano una nuova RdP", () => {
  assert.equal(diagnosticBlocks({ severity: "Blocking", status: "Open" }), true);
  assert.equal(diagnosticBlocks({ severity: "Critical", status: "Acknowledged" }), true);
  assert.equal(diagnosticBlocks({ severity: "Blocking", status: "Resolved" }), false);
  assert.equal(diagnosticBlocks({ severity: "Blocking", status: "Archived" }), false);
});

test("le diagnostiche archiviate spariscono dal dettaglio operativo", () => {
  assert.equal(visibleDiagnostic({ status: "Resolved" }), true);
  assert.equal(visibleDiagnostic({ status: "Archived" }), false);
});

test("AwaitingDecision espone la decisione v2 solo con analisi complete e senza blocchi", () => {
  const request = { contract_version: 2, workspace_status: "AwaitingDecision" };
  assert.equal(v2DecisionAvailability(request, [{ mes_payload: { snapshotHash: "a", blockCode: "" } }]).available, true);
  assert.equal(v2DecisionAvailability(request, [{ mes_payload: { snapshotHash: "a", blockCode: "BOM_MISSING" } }]).available, false);
  assert.equal(v2DecisionAvailability(request, []).available, false);
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

test("V4 assegna a ProgreMES risoluzione formule e nettificazione dei componenti diretti", () => {
  assert.equal(workbenchLineMappingStatus({ riga_descrittiva: true }), "NOT_APPLICABLE");
  assert.equal(workbenchLineMappingStatus({ riga_descrittiva: false }), "BOM_PENDING_IN_WORKSPACE");
  assert.equal(workbenchLineMappingStatus({ riga_descrittiva: false }, { mapping_status: "RESOLVED" }), "RESOLVED");
  const bom = { components: [{ articleCode: "AS001" }, { articleCode: "FP120C" }] };
  assert.equal(workbenchLineMappingStatus({ riga_descrittiva: false }, null, bom), "BOM_EXPLODED");
  const direct = workbenchBomComponent({ id: 1, line_number: 1, article_code: "AS001", quantity: 2, unit_of_measure: "PZ", component_kind: "DIRECT_COMPONENT" }, 100, 1);
  const formula = workbenchBomComponent({ id: 2, line_number: 2, article_code: "FP120C", quantity: .5, unit_of_measure: "MES_MANAGED", component_kind: "FORMULA_COMPONENT" }, 100, 1);
  assert.equal(direct.owner, "PROGREMES");
  assert.equal(direct.status, "TO_NET_IN_MES");
  assert.equal(formula.owner, "PROGREMES");
  assert.equal(formula.status, "TO_RESOLVE_IN_MES");
});

test("una diagnostica di un altro OCT non viene associata soltanto per codice articolo", () => {
  const line = { id: "line-current", codice_articolo: "DC0012C" };
  assert.equal(diagnosticMatchesWorkbenchLine({ articleCode: "DC0012C", workspaceOctLineRevisionId: "line-other" }, line), false);
  assert.equal(diagnosticMatchesWorkbenchLine({ articleCode: "DC0012C", workspaceOctLineRevisionId: "line-current" }, line), true);
  assert.equal(diagnosticMatchesWorkbenchLine({ articleCode: "DC0012C" }, line), false);
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

test("Apri dettaglio non avvia una sincronizzazione Mexal", async () => {
  const source = await readFile(new URL("../api/mexal/automation.js", import.meta.url), "utf8");
  const detailCase = source.slice(
    source.indexOf('case "progremes_workbench_detail"'),
    source.indexOf('case "progremes_diagnostic_action"'),
  );
  assert.match(detailCase, /productionWorkbenchDetail/);
  assert.doesNotMatch(detailCase, /syncWorkspaceV3MexalContracts|buildMexalClient/);
});
