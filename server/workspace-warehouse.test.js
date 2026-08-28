import test from "node:test";
import assert from "node:assert/strict";
import { getLastCost, mapArticleToOrdersCache } from "./mexal/sync-products.js";
import { warehouseRow, warehouseSummary } from "../src/pages/Warehouse/warehouseData.js";

test("il costo ultimo usa esclusivamente il contratto reale Mexal", () => {
  assert.equal(getLastCost({ costo_ult: "12,345678" }), 12.345678);
  assert.equal(getLastCost({ cos_ult: 4.5 }), 4.5);
  assert.equal(getLastCost({ costo_ult: -2 }), 0);
  assert.equal(getLastCost({ prezzo_listino: 99 }), 0);
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
