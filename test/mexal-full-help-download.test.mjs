import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildMexalClient } from "../server/mexal/sync-products.js";
import { downloadFullMexalHelp, findTechnicalCredentialPath } from "../server/mexal/full-help-download.js";

const fullPayload = {
  risorse: [{ endpoint: "/righe", schema: { properties: { quantity: 4, nested: { value: "immutata" } } } }],
  metadata: { version: 7.5, flags: [true, false, null] },
};
const calls = [];
const result = await downloadFullMexalHelp({ async getJson(path) { calls.push(path); return fullPayload; } }, () => "2026-07-22T00:00:00.000Z");
assert.deepEqual(calls, ["/help"], "il download legge solo /help");
assert.equal(result.payload, fullPayload, "il payload viene restituito senza copie o trasformazioni");
assert.deepEqual(result.payload.risorse[0].schema.properties.nested, { value: "immutata" }, "oggetti annidati preservati");
assert.deepEqual(result.payload.metadata.flags, [true, false, null], "array preservati");
assert.equal(result.payload.metadata.version, 7.5, "valori numerici preservati");
assert.equal(result.source, "/webapi/risorse/help");
assert.equal(result.downloadedAt, "2026-07-22T00:00:00.000Z");

await assert.rejects(() => downloadFullMexalHelp({ async getJson() { return { credentials: "technical-secret" }; } }), /download bloccato/i);
assert.equal(findTechnicalCredentialPath({ nested: { token: "x" } }), "$.nested.token");

process.env.MEXAL_BASE_URL = "https://mexal.example/"; process.env.MEXAL_USERNAME = "u"; process.env.MEXAL_PASSWORD = "p"; process.env.MEXAL_AZIENDA = "a"; process.env.MEXAL_ANNO = "2026"; process.env.MEXAL_MAGAZZINO = "1";
let requestOptions; const client = buildMexalClient({ request: async (options) => { requestOptions = options; return { status: 200, body: "{}" }; } }); await client.getJson("/help");
assert.equal(requestOptions.url, "https://mexal.example/webapi/risorse/help");
assert.equal(requestOptions.method, undefined, "buildMexalClient.getJson non invia POST, PUT, PATCH o DELETE");

const api = await readFile("api/mexal/orders/recover-sync.js", "utf8");
const page = await readFile("src/pages/Settings/MexalDiagnostics.jsx", "utf8");
const helper = await readFile("server/mexal/full-help-download.js", "utf8");
assert.match(api, /action === "full-help-download"/);
assert.match(api, /if \(!authorization\?\.isAdmin\) return res\.status\(403\)/, "i non amministratori ricevono 403");
assert.match(api, /downloadFullMexalHelp\(buildMexalClient\(\)\)/);
assert.doesNotMatch(helper, /console\.(?:log|info|warn|error)/, "il payload non viene registrato nei log");
assert.doesNotMatch(helper, /postJson|\.from\(|\.rpc\(/, "il download non scrive a Mexal o Supabase");
assert.match(page, /Scarica help Mexal completo/);
assert.match(page, /mexal-help-completo\.json/);
assert.match(page, /loading === "full-help-download"/);
assert.match(page, /Download help Mexal non riuscito/);
console.log("Mexal full help download: admin action, GET-only client URL, intact payload and UI download verified");
