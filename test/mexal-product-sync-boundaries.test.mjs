import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  STOCK_WAREHOUSE,
  assertStockWarehouse,
  getAllArticles,
  isActiveArticle,
  isWorkspaceProductCode,
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

const api = await readFile("server/mexal/sync-products.js", "utf8");
const productsPage = await readFile("src/pages/Products/Products.jsx", "utf8");

assert.equal(
  productsPage.includes('.eq("attivo_mexal", true)') &&
    productsPage.includes('.or("codice_mexal.ilike.IT%,codice_mexal.ilike.MKT%")'),
  true,
  "the Products screen retains active IT/MKT filtering in its query",
);

assert.equal(STOCK_WAREHOUSE, 5, "availability is bound to warehouse 5");
assert.doesNotThrow(() => assertStockWarehouse("5"));
assert.throws(() => assertStockWarehouse("1"), /magazzino 5/);
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
  stockBlock.includes("assertStockWarehouse(mexal.magazzino)"),
  true,
  "stock sync rejects warehouses other than 5",
);
assert.equal(
  stockBlock.includes('.eq("sincronizzato_mexal", true).eq("attivo_mexal", true)'),
  true,
  "stock updates only synchronized active articles",
);

console.log("Mexal product sync and presentation boundaries are enforced");