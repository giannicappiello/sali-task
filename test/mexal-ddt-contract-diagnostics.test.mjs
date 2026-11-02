import { test } from "node:test";
import assert from "node:assert/strict";
import { runDdtContractDiagnostics } from "../server/mexal/ddt-contract-diagnostics.js";

const help = { risorse: [{ documenti: [{ regexp: "^/documenti/moduli-stampa(/(?<sigla>[A-Z]*)){0,1}$", method: "GET" }] }] };
test("DDT diagnostic only reads an advertised module endpoint and never certifies PDF delivery", async () => {
  const calls = [];
  const result = await runDdtContractDiagnostics({ async getJson(path) {
    calls.push(path);
    return path === "/help" ? help : { moduli: [{ codice: "F" }, { codice: "S" }] };
  } });
  assert.deepEqual(calls, ["/help", "/documenti/moduli-stampa/BC"]);
  assert.equal(result.modules.ok, true);
  assert.equal(result.contractVerified, false);
  assert.equal(result.pdfEndpointAdvertised, false);
});
test("DDT diagnostic fails closed for missing GET contract or reserved fields", async () => {
  const calls = [];
  const result = await runDdtContractDiagnostics({ async getJson(path) { calls.push(path); return { risorse: [] }; } });
  assert.deepEqual(calls, ["/help"]);
  assert.equal(result.modules.ok, false);
  await assert.rejects(runDdtContractDiagnostics({ async getJson(path) {
    return path === "/help" ? help : { nested: { token: "private" } };
  } }), /riservati/);
});
