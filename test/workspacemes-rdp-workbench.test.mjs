import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { appendProgremesContext } from "../server/progremes-sso.js";

const [ui, production, api, migration] = await Promise.all([
  readFile("src/pages/Production/RdpWorkbench.jsx", "utf8"),
  readFile("src/pages/Production/Production.jsx", "utf8"),
  readFile("api/mexal/automation.js", "utf8"),
  readFile("supabase/migrations/20260826170000_workspacemes_rdp_create_permission.sql", "utf8"),
]);

test("Workbench espone lista OCT, multi-select e stati operativi senza duplicare le schermate MES", () => {
  for (const label of ["OCT da valutare", "RdP", "In produzione", "Completati / evasi", "Bloccati"]) assert.match(ui, new RegExp(label, "i"));
  assert.match(ui, /type="checkbox"/);
  assert.match(ui, /orderIds: selected/);
  assert.match(ui, /NESSUNA NETTIFICAZIONE WORKSPACE/);
  for (const screen of ["Planning", "Produzione", "Operatore produzione", "Confezionamento", "Magazzino", "Documenti"]) assert.match(ui, new RegExp(screen));
  assert.match(production, /RdP Workbench/);
});

test("preview, invio e decisione applicano permessi RdP dedicati", () => {
  assert.match(api, /progremes_production_preview[\s\S]*?rdp\.create/);
  assert.match(api, /progremes_production_request[\s\S]*?rdp\.create/);
  assert.match(api, /progremes_production_confirm[\s\S]*?rdp\.decide/);
  assert.match(migration, /rdp\.create/);
  assert.match(api, /if \(!permissionCode && internalSecrets/);
});

test("deep link conserva solo contesto MES allow-listed", () => {
  assert.equal(appendProgremesContext("/Planning", { rdpId: "rdp-1", octId: "oct-2", secret: "no" }), "/Planning?rdpId=rdp-1&octId=oct-2");
  assert.equal(appendProgremesContext("//evil.example", { rdpId: "x" }), "//evil.example");
});

test("UI impedisce doppio click e separa dati commerciali da analisi MES", () => {
  assert.match(ui, /if \(!sendEnabled \|\| !preview \|\| busy\) return/);
  assert.match(ui, /disabled=\{busy\}/);
  assert.match(ui, /Dati commerciali OCT/);
  assert.match(ui, /Analisi produttiva MES/);
  for (const field of ["PhysicalQuantity", "CommittedQuantity", "FreeQuantity", "MissingQuantity", "ProducibleQuantity", "PlannableQuantity", "BlockCode"]) assert.match(ui, new RegExp(field));
  assert.match(ui, /OCT MODIFICATO IN MEXAL/);
});

test("UI disabilita preview e Crea RdP quando il gate Production non è ON", () => {
  assert.match(ui, /productionGates\?\.allOn === true/);
  assert.match(ui, /disabled=\{busy \|\| !sendEnabled\}/);
  assert.match(ui, /Invio RdP Production non disponibile/);
  assert.match(production, /Invio RdP Workspace/);
  assert.match(production, /Gate Production/);
});
