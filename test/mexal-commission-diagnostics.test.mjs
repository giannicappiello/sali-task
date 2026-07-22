import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { findCommissionCandidates, sanitizeCommissionJson } from "../server/mexal/commission-diagnostics.js";

const helper = await readFile("server/mexal/commission-diagnostics.js", "utf8");
const api = await readFile("api/mexal/orders/recover-sync.js", "utf8");
const page = await readFile("src/pages/Settings/MexalDiagnostics.jsx", "utf8");

assert.match(api, /action === "commission-diagnostics"/);
assert.match(api, /runCommissionDiagnostics\(buildMexalClient\(\), admin/);
assert.match(helper, /getJson\(/, "la diagnostica legge Mexal via GET");
assert.doesNotMatch(helper, /postJson\(/, "la diagnostica non invia documenti a Mexal");
assert.match(page, /Analisi campi provvigionali reali/);
assert.match(page, /Scarica report JSON/);

const sanitized = sanitizeCommissionJson({ codice_agente: "602.00040", perc_provv: 7.5, ragione_sociale: "Da non mostrare" });
assert.equal(sanitized.codice_agente, "602.00040");
assert.equal(sanitized.perc_provv, 7.5);
assert.equal(sanitized.ragione_sociale.redacted, true);
const found = findCommissionCandidates({ righe: [{ perc_provv: 7.5, codice_agente: "602.00040" }] });
assert.deepEqual(found.map((item) => item.path), ["$.righe[0].perc_provv", "$.righe[0].codice_agente"]);
assert.ok(found.every((item) => item.reliability === "candidato"));

console.log("Mexal commission diagnostics: read-only probes, sanitization and recursive candidates verified");
