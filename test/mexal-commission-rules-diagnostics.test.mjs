import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildMexalClient } from "../server/mexal/sync-products.js";
import { CANDIDATE_RESOURCES, extractCommissionCatalog, runCommissionRulesDiagnostics, summarizeCommissionCandidate } from "../server/mexal/commission-rules-diagnostics.js";

const help = { resources: [{ resource: "Regole agenti", endpoint: "/regole-agenti", method: "GET", description: "Provvigioni per agente", parameters: { cliente: { required: true } }, schema: { properties: { cod_cat_pr: {}, perc_provv: {} } } }, { resource: "Regole agenti duplicate", endpoint: "/regole-agenti", method: "GET", description: "commission" }, { resource: "Scrittura", endpoint: "/regole-agenti", method: "POST", description: "provvigioni" }, { resource: "Lettura", endpoint: "/matrice", method: "GET", description: "categoria provvigionale", schema: { properties: { categoria_cliente: {}, categoria_prodotto: {}, percentuale_provvigione: {} } } }, ["agenti", { url: "/array-agenti", methods: ["GET", "DELETE"], description: "condizioni agenti" }]] };
const catalog = extractCommissionCatalog(help);
assert.equal(CANDIDATE_RESOURCES[0], "/help");
assert.equal(CANDIDATE_RESOURCES.some((path) => path.includes("help.json")), false);
assert.equal(catalog.filter((item) => item.endpoint === "/regole-agenti" && item.method === "GET").length, 1, "endpoint and method are deduplicated");
assert.ok(catalog.some((item) => item.endpoint === "/array-agenti" && item.matched_terms.includes("agenti")), "arrays and textual values are scanned");
assert.ok(catalog.some((item) => item.endpoint === "/matrice" && item.matched_terms.includes("categoria provvigionale")), "values are scanned recursively");

const summary = summarizeCommissionCandidate({ dati: [{ cod_cat_pr: 2, perc_provv: 7.5, ragione_sociale: "Segreto", nested: { token: "no" } }] });
assert.equal(summary.record_count, 1); assert.equal(JSON.stringify(summary).includes("Segreto"), false, "sensitive data is redacted");
const calls = [];
const report = await runCommissionRulesDiagnostics({ lastHttpStatus: 200, async getJson(path) { calls.push(path); if (path === "/help") return help; return { dati: [{ categoria_cliente: 2, categoria_prodotto: 3, percentuale_provvigione: 7.5, token: "secret" }] }; } });
assert.equal(calls[0], "/help");
assert.ok(!calls.includes("/regole-agenti"), "documented endpoint with required parameters is not queried");
assert.equal(report.endpointTests.find((item) => item.endpoint === "/array-agenti" && item.method === "DELETE").status, "documentato ma non interrogato", "DELETE is excluded");
assert.equal(report.endpointTests.find((item) => item.endpoint === "/regole-agenti" && item.method === "POST").status, "documentato ma non interrogato");
assert.equal(report.endpointTests.find((item) => item.endpoint === "/matrice").response.scalar_preview.length, 1, "record preview is bounded");
assert.equal(report.endpointVerified, true, "only a complete customer/product/percentage relationship verifies an endpoint");
const incomplete = await runCommissionRulesDiagnostics({ async getJson(path) { return path === "/help" ? { endpoint: "/only", method: "GET", description: "provvigioni" } : { dati: [{ cod_cat_pr: 2, perc_provv: 7.5 }] }; } });
assert.equal(incomplete.endpointVerified, false, "separate category-like fields do not verify a relationship");

process.env.MEXAL_BASE_URL = "https://mexal.example/"; process.env.MEXAL_USERNAME = "u"; process.env.MEXAL_PASSWORD = "p"; process.env.MEXAL_AZIENDA = "a"; process.env.MEXAL_ANNO = "2026"; process.env.MEXAL_MAGAZZINO = "1";
let requestedUrl = ""; const client = buildMexalClient({ request: async ({ url }) => { requestedUrl = url; return { status: 200, body: "{}" }; } }); await client.getJson("/help");
assert.equal(requestedUrl, "https://mexal.example/webapi/risorse/help");
const api = await readFile("api/mexal/orders/recover-sync.js", "utf8"); const page = await readFile("src/pages/Settings/MexalDiagnostics.jsx", "utf8");
assert.match(api, /action === "commission-rules-diagnostics"/); assert.match(api, /authorization\?\.isAdmin/); assert.match(page, /Catalogo Mexal/); assert.match(page, /Scarica report JSON/);
console.log("Mexal commission rules diagnostics: real catalogue, GET-only probes, bounds and relationship verification verified");
