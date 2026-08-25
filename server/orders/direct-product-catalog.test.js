import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { directProductPrefix, isDirectMexalProductCode, isDirectProductCode } from "../../shared/directProductCatalog.js";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const directPage = read("src/pages/Products/Products.jsx");
const newOrder = read("src/modules/orders/pages/NewOrder.jsx");
const aiOrder = read("server/ai/order-document.js");

test("ORDINIPH, ORDINIPR e PRODOTTI DIRECT riusano lo stesso catalogo canonico", () => {
  assert.match(directPage, /loadDirectProductCatalog\(supabase\)/);
  assert.match(newOrder, /loadDirectProductCatalog\(supabase, \{ includeEconomics: true \}\)/);
  assert.match(aiOrder, /applyDirectMexalProductFilters/);
  assert.match(aiOrder, /ordini_impianti/);
});

test("il filtro condiviso ammette soltanto IT, MKT e IMP", () => {
  assert.equal(isDirectMexalProductCode("IT001"), true);
  assert.equal(isDirectMexalProductCode("MKT001"), true);
  assert.equal(isDirectMexalProductCode("IMP001"), false);
  assert.equal(isDirectProductCode("IMP001"), true);
  assert.equal(directProductPrefix("zz001"), "");
});
