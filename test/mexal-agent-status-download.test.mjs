import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  downloadAgentStatusSamples,
  supplierCode,
  supplierRows,
} from "../server/mexal/agent-status-download.js";

const activeRecord = {
  codice: "602.00001",
  denominazione: "Agente attivo",
  stato_reale: "A",
  nested: { untouched: true },
};
const inactiveRecord = {
  codice_fornitore: "602.00002",
  denominazione: "Agente disattivato",
  stato_reale: "C",
  nested: { untouched: false },
};
const calls = [];
const pages = [
  { fornitori: [activeRecord, { codice: "501.00001" }], next: "pagina 2" },
  { data: [inactiveRecord] },
];

const result = await downloadAgentStatusSamples({
  async getJson(path) {
    calls.push(path);
    return pages[calls.length - 1];
  },
}, {
  activeAgentCode: " 602.00001 ",
  inactiveAgentCode: "602.00002",
  now: () => "2026-07-24T00:00:00.000Z",
});

assert.deepEqual(calls, [
  "/fornitori?max=500",
  "/fornitori?max=500&next=pagina+2",
]);
assert.equal(result.source, "/webapi/risorse/fornitori");
assert.equal(result.downloadedAt, "2026-07-24T00:00:00.000Z");
assert.equal(result.pagesRead, 2);
assert.equal(result.recordsRead, 3);
assert.equal(result.records.active, activeRecord, "il record attivo resta identico al JSON Mexal");
assert.equal(result.records.inactive, inactiveRecord, "il record disattivato resta identico al JSON Mexal");
assert.deepEqual(result.records.active.nested, { untouched: true });
assert.deepEqual(result.records.inactive.nested, { untouched: false });

assert.deepEqual(supplierRows([{ codice: "602.1" }]), [{ codice: "602.1" }]);
assert.deepEqual(supplierRows({ records: [{ codice: "602.2" }] }), [{ codice: "602.2" }]);
assert.equal(supplierCode({ cod_conto: " 602.00003 " }), "602.00003");

await assert.rejects(
  () => downloadAgentStatusSamples({ async getJson() { return []; } }, { activeAgentCode: "", inactiveAgentCode: "602.2" }),
  /Inserisci il codice/,
);
await assert.rejects(
  () => downloadAgentStatusSamples({ async getJson() { return []; } }, { activeAgentCode: "602.1", inactiveAgentCode: "602.1" }),
  /devono essere diversi/,
);
await assert.rejects(
  () => downloadAgentStatusSamples({ async getJson() { return []; } }, { activeAgentCode: "602.1", inactiveAgentCode: "602.2" }),
  /non trovati/,
);

const api = await readFile("api/mexal/orders/recover-sync.js", "utf8");
const page = await readFile("src/pages/Settings/MexalDiagnostics.jsx", "utf8");
const helper = await readFile("server/mexal/agent-status-download.js", "utf8");

assert.match(api, /action === "download-agent-status-samples"/);
assert.match(api, /Download agenti Mexal riservato agli amministratori/);
assert.match(api, /downloadAgentStatusSamples\(buildMexalClient\(\)/);
assert.match(api, /mexal-agenti-attivo-disattivato\.json/);
assert.match(page, /Diagnostica stato agenti Mexal/);
assert.match(page, /Codice agente attivo/);
assert.match(page, /Codice agente disattivato/);
assert.match(page, /Scarica JSON agenti/);
assert.doesNotMatch(helper, /console\.(?:log|info|warn|error)/, "i record non vengono registrati nei log");
assert.doesNotMatch(helper, /postJson|\.from\(|\.rpc\(/, "la diagnostica non scrive a Mexal o Supabase");

console.log("Mexal agent status download: admin-only, GET-only, paginated and raw records verified");
