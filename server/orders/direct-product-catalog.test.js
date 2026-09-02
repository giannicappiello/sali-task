import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { directProductPrefix, isDirectMexalProductCode, isDirectProductCode } from "../../shared/directProductCatalog.js";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const directPage = read("src/pages/Products/Products.jsx");
const implantsEditor = read("src/modules/orders/pages/Products.jsx");
const newOrder = read("src/modules/orders/pages/NewOrder.jsx");
const aiOrder = read("server/ai/order-document.js");
const componentPriceMigration = read("supabase/migrations/20260902164000_ph_shipped_and_implant_component_prices.sql");

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

test("il prezzo del singolo prodotto impianto è modificabile, persistito e usato nell'ordine", () => {
  assert.match(componentPriceMigration, /add column if not exists prezzo_unitario numeric\(14,4\)/);
  assert.match(implantsEditor, /aria-label=\{`Prezzo unitario \$\{row\.codice_articolo\}`\}/);
  assert.match(implantsEditor, /prezzo_unitario: numericPrice\(item\.prezzo_unitario\)/);
  assert.match(newOrder, /component\.prezzo_unitario \?\? component\.prodotto\?\.prezzo_listino/);
});

test("gli Ordini PH già riconciliati vengono riallineati a spediti", () => {
  assert.match(componentPriceMigration, /set stato = 'spedito'/);
  assert.match(componentPriceMigration, /modulo_ordini[\s\S]*= 'ph'/);
  assert.match(componentPriceMigration, /stato_sincronizzazione = 'non_inviato'/);
});
