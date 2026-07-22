import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { LIST_PRICE_COMMISSIONS_ENDPOINT, runListPriceCommissionsDiagnostics, summarizeListPriceCommissionsPayload } from "../server/mexal/list-price-commissions-diagnostics.js";

const calls = [];
const payload = [{ cliente: "C1", articolo: "IT1", agente: "A1", percentuale_provvigione: 7.5, formula: "P", categoria_cliente: 2, categoria_articolo: 3, listino: "L1", nested: { valuta: "EUR" } }];
const result = await runListPriceCommissionsDiagnostics({ async getJson(path) { calls.push(path); return payload; } });
assert.deepEqual(calls, [LIST_PRICE_COMMISSIONS_ENDPOINT]);
assert.equal(result.summary.recordCount, 1); assert.equal(result.summary.payloadType, "array"); assert.equal(result.summary.wrapper, null);
assert.deepEqual(result.payload, payload, "the download payload stays complete and unmodified");
assert.ok(result.summary.fields.potentiallyRelevant.cliente.includes("cliente"));
assert.ok(result.summary.fields.potentiallyRelevant.articolo.includes("articolo"));
assert.ok(result.summary.fields.potentiallyRelevant.agente.includes("agente"));
assert.ok(result.summary.fields.potentiallyRelevant.percentuale.includes("percentuale_provvigione"));
assert.ok(result.summary.fields.potentiallyRelevant.formula.includes("formula"));
assert.ok(result.summary.fields.potentiallyRelevant.listino.includes("listino"));
assert.equal(JSON.stringify(result.summary).includes("C1"), false, "summary never includes record values or the full payload");

for (const [wrapper, value] of [["dati", [{ cod_cat_pr: 2 }]], ["data", [{ id_categoria_pr: 3 }]], ["records", [{ perc_provv: 7.5 }]]]) {
  const summary = summarizeListPriceCommissionsPayload({ [wrapper]: value });
  assert.equal(summary.wrapper, wrapper); assert.equal(summary.recordCount, 1);
}
assert.equal(summarizeListPriceCommissionsPayload([]).recordCount, 0);
assert.equal(summarizeListPriceCommissionsPayload(null).payloadType, "null");
assert.equal(summarizeListPriceCommissionsPayload({ percentuale: 7.5 }).recordCount, 1, "single objects are supported");
const limited = summarizeListPriceCommissionsPayload({ one: { two: { three: "x" } }, many: [{ a: 1 }, { b: 2 }] }, { maxDepth: 2, maxElements: 3 });
assert.equal(limited.analysisLimits.depthLimitReached, true); assert.equal(limited.analysisLimits.elementLimitReached, true);
const paged = summarizeListPriceCommissionsPayload({ dati: [], next_token: "opaque", total: 50, has_more: true });
assert.equal(paged.pagination.detected, true); assert.equal(paged.completenessGuaranteed, false); assert.equal(paged.pagination.fetchedPages, 1);
assert.equal(summarizeListPriceCommissionsPayload({ dati: [], has_more: false }).completenessGuaranteed, true);

const service = await readFile("server/mexal/list-price-commissions-diagnostics.js", "utf8");
assert.doesNotMatch(service, /\.postJson\(|method:\s*["'](?:POST|PUT|PATCH|DELETE)/i, "diagnostic module is GET-only");
assert.doesNotMatch(service, /provvigioni-listini\/ricerca/, "the undocumented search endpoint is never used");
const api = await readFile("api/mexal/orders/recover-sync.js", "utf8");
assert.match(api, /action === "list-price-commissions-diagnostics"/); assert.match(api, /action === "download-list-price-commissions"/);
assert.match(api, /!authorization\?\.isAdmin\) return res\.status\(403\)/, "both actions are protected by the existing admin guard");
assert.match(api, /Content-Disposition", "attachment; filename=\\"mexal-provvigioni-listini\.json\\"/);
assert.match(api, /Content-Type", "application\/json"/);
assert.doesNotMatch(api, /mexal_regole_provvigioni|mexal_categorie_provvigionali/, "diagnostic API does not write commission tables");
const page = await readFile("src/pages/Settings/MexalDiagnostics.jsx", "utf8");
assert.match(page, /Provvigioni listini/); assert.match(page, /Analizza provvigioni listini/); assert.match(page, /Scarica JSON provvigioni listini/);
assert.match(page, /Analisi in corso\.\.\./); assert.match(page, /Download in corso\.\.\./);
console.log("Mexal list-price commissions diagnostics: GET-only payload inspection, limits, download API and admin UI verified");
