import assert from "node:assert/strict";
import test from "node:test";

import { decorateProductionHealth, productionGoLiveGates, workspaceProductionGates } from "./workspace-production-gates.js";

const runtimeHealth = {
  globalStatus: "GREEN",
  blocking: 0,
  receiveRdp: true,
  receiveDecisions: true,
  executeProduction: true,
  createLots: true,
  receiveV4Previews: true,
  confirmV4Production: true,
};

const enabledEnv = {
  PROGREMES_URL: "https://mes.example.test",
  PROGREMES_INTEGRATION_SECRET: "test-secret",
  PROGREMES_PRODUCTION_REQUESTS_ENABLED: "true",
  PROGREMES_PRODUCTION_CALLBACKS_ENABLED: "true",
  PROGREMES_PRODUCTION_CONFIRMATIONS_ENABLED: "true",
  WORKSPACEMES_V4_PREVIEW_ENABLED: "true",
  WORKSPACEMES_V4_CONFIRM_ENABLED: "true",
};

test("gate Workspace Production fallisce chiuso quando un flag o una configurazione manca", () => {
  assert.equal(workspaceProductionGates({}).allOn, false);
  for (const key of Object.keys(enabledEnv)) {
    const env = { ...enabledEnv };
    delete env[key];
    assert.equal(workspaceProductionGates(env).allOn, false, key);
  }
});

test("GO-LIVE richiede i gate V4, esecuzione e lotti ProgreMES", () => {
  assert.equal(productionGoLiveGates(runtimeHealth, enabledEnv).allOn, true);
  for (const key of ["receiveV4Previews", "confirmV4Production", "executeProduction", "createLots"]) {
    assert.equal(productionGoLiveGates({ ...runtimeHealth, [key]: false }, enabledEnv).allOn, false, key);
  }
});

test("Centro Diagnostico diventa RED e aggiunge un blocking quando il gate Production è OFF", () => {
  const decorated = decorateProductionHealth(runtimeHealth, {});
  assert.equal(decorated.globalStatus, "RED");
  assert.equal(decorated.blocking, 1);
  assert.equal(decorated.productionGates.allOn, false);
  const ready = decorateProductionHealth(runtimeHealth, enabledEnv);
  assert.equal(ready.globalStatus, "GREEN");
  assert.equal(ready.blocking, 0);
  assert.equal(ready.productionGates.allOn, true);
});
