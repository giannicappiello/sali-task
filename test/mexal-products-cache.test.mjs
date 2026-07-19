import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { extractArticleRows, mapArticleToOrdersCache } from "../server/mexal/sync-products.js";

const payload = { dati: [{ codice: " IT0001 " }, { codice_articolo: "mkt-2" }, { codice: "IMP3" }, { codice: "NO4" }] };
const rows = extractArticleRows(payload);
assert.equal(rows.length, 4, "parses the Mexal dati list wrapper");
const api = await readFile("server/mexal/sync-products.js", "utf8");
const service = await readFile("src/modules/integrations/services/mexalSyncService.js", "utf8");
assert.match(api, /normalizeCode\(value\).*trim\(\)\.toUpperCase\(\)/s);
assert.match(api, /ARTICLE_PREFIXES = \["IT", "MKT", "IMP"\]/);
assert.match(api, /async function findExistingProduct[\s\S]*\.from\("prodotti"/);
assert.match(api, /async function saveProduct[\s\S]*\.from\("prodotti"/);
assert.match(api, /async function saveProduct[\s\S]*brand_mexal:[\s\S]*linea_mexal:[\s\S]*categoria_mexal:[\s\S]*sottocategoria_mexal:/);
assert.match(api, /async function syncCatalogImage/);
assert.match(api, /ensureImageBucket\(supabase\)/);
assert.match(api, /\.from\("ordini_prodotti_cache"\)/);
assert.match(api, /onConflict: "codice_articolo"/);
assert.match(api, /codice_articolo: code/);
assert.match(api, /mappedByCode = new Map/);
assert.match(api, /saveProduct[\s\S]*mapArticleToOrdersCache/);
assert.match(api, /assertRunStillRunning[\s\S]*upsertOrdersProductsCache/);
assert.match(api, /cache_writes: totals/);
assert.match(api, /previousInserted[\s\S]*totalProductWrites[\s\S]*totalCacheWrites/);
assert.match(api, /noRowsDiagnostic[\s\S]*"failed"[\s\S]*"completed"/);
assert.doesNotMatch(api, /completed_with_errors/);
assert.doesNotMatch(api, /\.delete\(\).*ordini_prodotti_cache/s);
const cacheRow = mapArticleToOrdersCache({
  codice: " IT0001 ",
  descrizione: "Articolo test",
  descrizione_agg: " completo",
  descr_completa: "Descrizione estesa",
  cod_alternativo: "ALT-1",
  unita_misura: "PZ",
  cod_aliquota_iva: "22",
  id_cat_sconto: "7",
  id_cat_prezzo: "8",
  prz_listino: [[1, "12.50"]],
  qta_inventario: "3",
  qta_carico: "2",
  qta_scarico: "1",
  impegnato: "1.25",
  scheda_tecnica_url: "https://example.test/scheda.pdf",
  materiale_pubblicitario_url: "https://example.test/materiale.pdf",
}, { imageUrl: "https://example.test/catalogo.jpg" });
const cacheColumns = [
  "codice_articolo", "descrizione", "descrizione_completa", "codice_alternativo",
  "unita_misura", "aliquota_iva", "categoria_sconto", "categoria_prezzo",
  "prezzo_listino", "giacenza", "impegnato", "disponibilita", "mostra_in_app",
  "immagine_url", "scheda_tecnica_url", "materiale_pubblicitario_url", "dati_mexal",
  "sincronizzato_il",
];
assert.deepEqual(Object.keys(cacheRow).sort(), [...cacheColumns].sort(), "cache payload contains only real columns");
assert.equal(cacheRow.codice_articolo, "IT0001");
assert.equal(cacheRow.descrizione, "Articolo testcompleto");
assert.equal(cacheRow.mostra_in_app, true);
assert.equal(cacheRow.sincronizzato_il !== undefined, true);
assert.equal(cacheRow.sincronizzata_il, undefined);
for (const column of ["attivo_mexal", "brand", "categoria", "sottocategoria"]) {
  assert.equal(cacheRow[column], undefined, `${column} is not written to the order cache`);
}
for (const column of ["prezzo_listino", "giacenza", "impegnato", "disponibilita"]) {
  assert.equal(typeof cacheRow[column], "number", `${column} is a valid numeric value`);
}
assert.equal(cacheRow.dati_mexal.codice, " IT0001 ");
assert.equal(cacheRow.immagine_url, "https://example.test/catalogo.jpg");
assert.equal(mapArticleToOrdersCache({ codice: "IT0001" }).descrizione, "IT0001", "description falls back to article code");
const invalidNumericRow = mapArticleToOrdersCache({
  codice: "IT0002",
  prz_listino: [[1, "not-a-number"]],
  qta_inventario: "not-a-number",
  impegnato: "not-a-number",
});
assert.equal(invalidNumericRow.prezzo_listino, null, "invalid prices are not written as strings");
assert.equal(invalidNumericRow.giacenza, 0, "invalid stock uses the schema default value");
assert.equal(invalidNumericRow.impegnato, 0, "invalid commitments use the schema default value");
assert.match(api, /status: "failed", completed_at: new Date\(\)\.toISOString\(\), error_message: error\?\.message/);
assert.match(service, /syncRunId = data\.sync_run_id \|\| syncRunId/);
assert.match(service, /prodottiInserted[\s\S]*prodottiUpdated/);
assert.match(service, /total\.inserted \+ total\.updated \+ total\.prodottiInserted \+ total\.prodottiUpdated === 0/);
const dashboardProductsCountQuery = service
  .split("\n")
  .find((line) => line.includes('.from("ordini_prodotti_cache")'));
assert.match(dashboardProductsCountQuery, /\.select\("\*", \{ count: "exact", head: true \}\).*\.eq\("mostra_in_app", true\)/);
assert.doesNotMatch(dashboardProductsCountQuery, /attivo_mexal/);
console.log("products and order cache writes, image preservation, cumulative counters, supported statuses and stop checks are wired");
