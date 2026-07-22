import assert from "node:assert/strict";
import { ARTICLE_ENDPOINT, CUSTOMER_ENDPOINT, extractCommissionCategoryRows, syncCommissionCategories } from "../server/mexal/sync-commission-categories.js";
import { collectionPathFromRegexp, extractCommissionCatalog } from "../server/mexal/commission-rules-diagnostics.js";
import { readFile } from "node:fs/promises";

const calls = [];
const pages = new Map([
  [CUSTOMER_ENDPOINT, { dati: [{ codice: 2, descrizione: "Farmacie", attivo: "S" }], next: "customer-2" }],
  [`${CUSTOMER_ENDPOINT}?next=customer-2`, { items: [{ codice: 4, descrizione: "Ospedali", attivo: "N" }] }],
  [ARTICLE_ENDPOINT, { data: [{ id_categoria_pr: 3, descrizione: "Cosmetici" }] }],
]);
const mexal = { async getJson(path) { calls.push(path); return pages.get(path) || {}; } };
const table = new Map();
const supabase = { from(name) { assert.equal(name, "mexal_categorie_provvigionali"); let filters = {}; return {
  select() { return this; }, eq(key, value) { filters[key] = value; return this; }, async maybeSingle() { return { data: table.get(`${filters.tipo}:${filters.codice_mexal}`) || null, error: null }; },
  update(value) { return { eq: async () => { const key = `${filters.tipo}:${filters.codice_mexal}`; table.set(key, { ...table.get(key), ...value }); return { error: null }; } }; },
  async upsert(value) { table.set(`${value.tipo}:${value.codice_mexal}`, value); return { error: null }; },
}; } };

let result = await syncCommissionCategories({ mexal, supabase, now: () => "2026-07-22T00:00:00.000Z" });
assert.deepEqual([...new Set(calls)].sort(), [CUSTOMER_ENDPOINT, `${CUSTOMER_ENDPOINT}?next=customer-2`, ARTICLE_ENDPOINT].sort(), "only documented GET collection endpoints are used");
assert.equal(result.letti_da_mexal, 3); assert.equal(result.categorie_clienti, 2); assert.equal(result.categorie_articoli, 1); assert.equal(result.inseriti, 3); assert.equal(table.get("cliente:2").descrizione, "Farmacie"); assert.equal(table.get("articolo:3").codice_mexal, "3");
result = await syncCommissionCategories({ mexal, supabase, now: () => "2026-07-23T00:00:00.000Z" });
assert.equal(result.inseriti, 0); assert.equal(result.invariati, 3, "second run is idempotent and has no duplicates");
pages.set(CUSTOMER_ENDPOINT, { results: [{ codice: 2, descrizione: "Farmacie aggiornate" }] }); pages.set(ARTICLE_ENDPOINT, []); calls.length = 0;
result = await syncCommissionCategories({ mexal, supabase });
assert.equal(result.aggiornati, 1); assert.equal(result.categorie_articoli, 0, "empty collection is handled without deleting local records"); assert.equal(table.get("cliente:2").descrizione, "Farmacie aggiornate");
assert.deepEqual(extractCommissionCategoryRows({ records: [] }), []);
assert.equal(collectionPathFromRegexp("^/dati-generali/categorie-provvigioni$"), CUSTOMER_ENDPOINT);
assert.equal(collectionPathFromRegexp("^/dati-generali/categorie-provvigioni-articoli/(?:[0-9]+)$"), ARTICLE_ENDPOINT);
const catalog = extractCommissionCatalog({ risorse: [{ regexp: "^/dati-generali/categorie-provvigioni$", descrizione: "categorie provvigioni", method: "GET", chiavi: [] }, { regexp: "^/dati-generali/provvigioni-listini$", descrizione: "provvigioni", method: "GET" }] });
assert.ok(catalog.some((item) => item.endpoint === CUSTOMER_ENDPOINT)); assert.ok(catalog.some((item) => item.endpoint === "/dati-generali/provvigioni-listini"));
const api = await readFile("api/mexal/orders/recover-sync.js", "utf8");
assert.match(api, /action === "sync-commission-categories"/); assert.match(api, /!authorization\?\.isAdmin\) return res\.status\(403\)/, "the administrative action blocks non-admin users");
const service = await readFile("server/mexal/sync-commission-categories.js", "utf8");
assert.doesNotMatch(service, /mexal_regole_provvigioni/, "category sync never writes local commission rules");
console.log("Mexal commission category sync: GET-only paging, wrappers, idempotent upsert and regexp catalogue parsing verified");
