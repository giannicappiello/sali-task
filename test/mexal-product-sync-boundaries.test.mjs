import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  STOCK_WAREHOUSE,
  buildMexalClient,
  filterArticlesByPrefix,
  getAllArticles,
  getAvailabilityWarehouse,
  isActiveArticle,
  isWorkspaceProductCode,
  normalizeTargetedArticlePrefix,
  selectAvailabilityClient,
} from "../server/mexal/sync-products.js";

const activeNonPresentationArticle = {
  codice: "PB0004",
  gest_annullato: "N",
  gest_precanc: "N",
};

assert.equal(
  isActiveArticle(activeNonPresentationArticle),
  true,
  "an active article outside IT/MKT remains eligible for master-data sync",
);
assert.equal(
  isActiveArticle({ ...activeNonPresentationArticle, gest_annullato: "S" }),
  false,
  "a cancelled article is excluded",
);
assert.equal(
  isActiveArticle({ ...activeNonPresentationArticle, gest_precanc: "S" }),
  false,
  "a pre-cancelled article is excluded",
);

assert.equal(isWorkspaceProductCode("IT0001"), true);
assert.equal(isWorkspaceProductCode("MKT0001"), true);
assert.equal(
  isWorkspaceProductCode("PB0004"),
  false,
  "presentation eligibility remains separate from sync eligibility",
);

const articlePages = [
  {
    dati: [{ codice: "IT0001" }, { codice: "PB0004" }],
    next: "page-2",
  },
  {
    dati: [{ codice: "MKT0002" }, { descrizione: "senza codice" }],
  },
];
const articles = await getAllArticles({
  lastHttpStatus: 200,
  async getJson() {
    return articlePages.shift();
  },
});

assert.deepEqual(
  articles.map((article) => article.codice),
  ["IT0001", "MKT0002", "PB0004"],
  "all coded articles cross the paginated master-data boundary",
);

assert.equal(normalizeTargetedArticlePrefix("pb"), "PB");
assert.equal(normalizeTargetedArticlePrefix(""), null);
assert.throws(
  () => normalizeTargetedArticlePrefix("IT"),
  { status: 400 },
  "only the explicitly approved PB scope is accepted",
);
assert.equal(
  filterArticlesByPrefix(articles, null),
  articles,
  "an unscoped automatic synchronization keeps the complete article set",
);
const pbArticles = filterArticlesByPrefix(articles, "PB");
assert.deepEqual(
  pbArticles.map((article) => article.codice),
  ["PB0004"],
  "the controlled PB synchronization cannot write other code families",
);
assert.equal(pbArticles.diagnostics.article_prefix, "PB");
assert.equal(pbArticles.diagnostics.selected_by_prefix, 1);

const api = await readFile("server/mexal/sync-products.js", "utf8");
const productsPage = await readFile("src/pages/Products/Products.jsx", "utf8");

assert.equal(
  api.includes("articlePrefix && authorization?.isAdmin !== true"),
  true,
  "targeted product synchronization is restricted to Workspace administrators",
);

assert.equal(
  productsPage.includes('.eq("attivo_mexal", true)') &&
    productsPage.includes('.or("codice_mexal.ilike.IT%,codice_mexal.ilike.MKT%")'),
  true,
  "the Products screen retains active IT/MKT filtering in its query",
);

assert.equal(STOCK_WAREHOUSE, 5);
assert.equal(getAvailabilityWarehouse("IT0001"), 5);
assert.equal(getAvailabilityWarehouse("MKT0001"), 5);
assert.equal(getAvailabilityWarehouse("PB0004"), null);
const warehouse5Client = { scope: "warehouse-5" };
const allWarehousesClient = { scope: "all-warehouses" };
const availabilityClients = {
  warehouse5: warehouse5Client,
  allWarehouses: allWarehousesClient,
};
assert.equal(selectAvailabilityClient("IT0001", availabilityClients), warehouse5Client);
assert.equal(selectAvailabilityClient("MKT0001", availabilityClients), warehouse5Client);
assert.equal(selectAvailabilityClient("PB0004", availabilityClients), allWarehousesClient);

const mexalEnvNames = [
  "MEXAL_BASE_URL",
  "MEXAL_USERNAME",
  "MEXAL_PASSWORD",
  "MEXAL_AZIENDA",
  "MEXAL_ANNO",
  "MEXAL_MAGAZZINO",
];
const originalMexalEnv = Object.fromEntries(
  mexalEnvNames.map((name) => [name, process.env[name]]),
);
Object.assign(process.env, {
  MEXAL_BASE_URL: "https://mexal.test",
  MEXAL_USERNAME: "test-user",
  MEXAL_PASSWORD: "test-password",
  MEXAL_AZIENDA: "1",
  MEXAL_ANNO: "2026",
  MEXAL_MAGAZZINO: "9",
});
const coordinates = [];
const request = async ({ headers }) => {
  coordinates.push(headers["Coordinate-Gestionale"]);
  return { status: 200, body: "{}" };
};
await buildMexalClient({ request, warehouse: 5 }).getJson("/articoli/IT0001");
await buildMexalClient({ request, warehouse: null }).getJson("/articoli/PB0004");
assert.deepEqual(coordinates, [
  "Azienda=1 Anno=2026 Magazzino=5",
  "Azienda=1 Anno=2026",
]);
for (const [name, value] of Object.entries(originalMexalEnv)) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
const stockBlock = api.slice(
  api.indexOf('if (action === "sync-stock-it")'),
  api.indexOf('if (action !== "sync")'),
);
assert.equal(
  stockBlock.includes('startsWith("IT")'),
  false,
  "stock sync has no article-code prefix filter",
);
assert.equal(
  stockBlock.includes("selectAvailabilityClient(code, availabilityClients)"),
  true,
  "stock sync selects warehouse 5 only for IT/MKT and all warehouses otherwise",
);
assert.equal(
  stockBlock.includes('.eq("sincronizzato_mexal", true).eq("attivo_mexal", true)'),
  true,
  "stock updates only synchronized active articles",
);

assert.equal((api.match(/selectAvailabilityClient\(code, availabilityClients\)/g) || []).length, 2, "both product and stock sync use conditional availability scope");

console.log("Mexal product sync and presentation boundaries are enforced");