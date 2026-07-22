import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { CANDIDATE_RESOURCES, runCommissionRulesDiagnostics, summarizeCommissionCandidate } from "../server/mexal/commission-rules-diagnostics.js";

const summary = summarizeCommissionCandidate({ dati: [{ cod_cat_pr: 2, perc_provv: 7.5, ragione_sociale: "Segreto" }, { id_categoria_pr: 3, formula_pr: "7,5" }] });
assert.equal(summary.record_count, 2);
assert.deepEqual(summary.candidate_fields.map((item) => item.path).sort(), ["$.dati[0].cod_cat_pr", "$.dati[0].perc_provv", "$.dati[1].formula_pr", "$.dati[1].id_categoria_pr"].sort());
assert.equal(JSON.stringify(summary).includes("Segreto"), false, "sensitive values are redacted from the summary");
assert.ok(CANDIDATE_RESOURCES.every((endpoint) => endpoint.endsWith("help.json")), "diagnostic probes only documented-help candidates");
const calls = [];
const report = await runCommissionRulesDiagnostics({ lastHttpStatus: 200, async getJson(path) { calls.push(path); if (path === "/agenti/help.json") throw Object.assign(new Error("HTTP 404"), { status: 404 }); return { dati: [{ perc_provv: 7.5 }] }; } });
assert.equal(calls.length, CANDIDATE_RESOURCES.length);
assert.equal(report.readOnly, true); assert.equal(report.endpointVerified, false);
assert.equal(report.endpoints.find((item) => item.endpoint === "/agenti/help.json").http_status, 404);
const api = await readFile("api/mexal/orders/recover-sync.js", "utf8");
assert.match(api, /action === "commission-rules-diagnostics"/);
assert.match(api, /authorization\?\.isAdmin/);
console.log("Mexal commission rules diagnostics: bounded GET-only candidate probes and admin endpoint verified");
