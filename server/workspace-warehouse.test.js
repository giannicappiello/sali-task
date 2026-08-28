import test from "node:test";
import assert from "node:assert/strict";
import { getLastCost, mapArticleToOrdersCache } from "./mexal/sync-products.js";
import { warehouseArticleType, warehouseBreakdown, warehouseRow, warehouseSummary } from "../src/pages/Warehouse/warehouseData.js";

test("il costo ultimo usa esclusivamente il contratto reale Mexal", () => {
  assert.equal(getLastCost({ costo_ult: "12,345678" }), 12.345678);
  assert.equal(getLastCost({ cos_ult: 4.5 }), 4.5);
  assert.equal(getLastCost({ costo_ult: -2 }), 0);
  assert.equal(getLastCost({ prezzo_listino: 99 }), 0);
});

test("dashboard classifica i prefissi e non somma quantità di UDM differenti", () => {
  assert.equal(warehouseArticleType("mp001"), "MP");
  assert.equal(warehouseArticleType("ZZ001"), "ALTRI");
  const result = warehouseBreakdown([
    { codice_articolo: "MP001", unita_misura: "KG", giacenza: 10, impegnato: 2, disponibilita: 8, costo_ultimo: 3 },
    { codice_articolo: "IT001", unita_misura: "PZ", giacenza: 4, impegnato: 1, disponibilita: 3, costo_ultimo: 5 },
  ]);
  assert.equal(result.byType.find((item) => item.type === "MP").value, 30);
  assert.equal(result.byUnit.length, 2);
  assert.equal(result.byUnit.find((item) => item.unit === "KG").quantity, 10);
});

test("la cache Workspace conserva costo, UDM e quantità di magazzino", () => {
  const row = mapArticleToOrdersCache({ codice: "IT001", descrizione: "Articolo", um_principale: "PZ", costo_ult: "2,50", qta_inventario: 10, impegnato: 3 });
  assert.equal(row.costo_ultimo, 2.5);
  assert.equal(row.giacenza, 10);
  assert.equal(row.impegnato, 3);
  assert.equal(row.unita_misura, "PZ");
});

test("la valorizzazione usa costo ultimo per giacenza e disponibilità", () => {
  const row = warehouseRow({ codice_articolo: "IT001", giacenza: 10, impegnato: 3, disponibilita: 7, costo_ultimo: 2.5 });
  assert.equal(row.stockValue, 25);
  assert.equal(row.availableValue, 17.5);
  const summary = warehouseSummary([row, { codice_articolo: "IT002", giacenza: 4, disponibilita: 4, costo_ultimo: 0 }]);
  assert.deepEqual({ articles: summary.articles, valued: summary.valuedArticles, stockValue: summary.stockValue }, { articles: 2, valued: 1, stockValue: 25 });
});
