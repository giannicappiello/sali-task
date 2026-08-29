import test from "node:test";
import assert from "node:assert/strict";
import { discoverWarehouseCollection, getAvailabilityWarehouse, getLastCost, mapArticleToOrdersCache, mapArticleWarehouseStock, normalizeMexalWarehouse } from "./mexal/sync-products.js";
import { nonNegativeWarehouseRows, warehouseArticleType, warehouseBreakdown, warehouseLocation, warehouseRow, warehouseScopedRows, warehouseSummary } from "../src/pages/Warehouse/warehouseData.js";

test("il costo ultimo usa esclusivamente il contratto reale Mexal", () => {
  assert.equal(getLastCost({ costo_ult: "12,345678" }), 12.345678);
  assert.equal(getLastCost({ cos_ult: 4.5 }), 4.5);
  assert.equal(getLastCost({ costo_ult: -2 }), 0);
  assert.equal(getLastCost({ prezzo_listino: 99 }), 0);
});

test("dashboard classifica i prefissi e non somma quantità di UDM differenti", () => {
  assert.equal(warehouseArticleType("mp001"), "MP");
  assert.equal(warehouseArticleType("mkt001"), "MKT");
  assert.equal(warehouseArticleType("ZZ001"), "ALTRI");
  const result = warehouseBreakdown([
    { codice_articolo: "MP001", unita_misura: "KG", giacenza: 10, impegnato: 2, disponibilita: 8, costo_ultimo: 3 },
    { codice_articolo: "IT001", unita_misura: "PZ", giacenza: 4, impegnato: 1, disponibilita: 3, costo_ultimo: 5 },
  ]);
  assert.equal(result.byType.find((item) => item.type === "MP").value, 30);
  assert.equal(result.byUnit.length, 2);
  assert.equal(result.byUnit.find((item) => item.unit === "KG").quantity, 10);
  assert.equal(result.byWarehouse.find((item) => item.type === "MAG-5").articles, 1);
});

test("il magazzino usa i dati reali disponibili senza inventare ubicazioni", () => {
  assert.equal(warehouseLocation({ codice_articolo: "MP001", dati_mexal: { id_magazzino: 8 } }), "MAG-8");
  assert.equal(warehouseLocation({ codice_articolo: "IT001" }), "MAG-5");
  assert.equal(warehouseLocation({ codice_articolo: "MP001" }), "Aggregato");
});

test("i riepiloghi escludono le giacenze negative mantenendole nell'elenco", () => {
  const eligible = nonNegativeWarehouseRows([
    { codice_articolo: "MP001", giacenza: 5, costo_ultimo: 2 },
    { codice_articolo: "MP002", giacenza: -3, costo_ultimo: 7 },
  ]);
  assert.equal(eligible.length, 1);
  assert.equal(warehouseSummary(eligible).stockValue, 10);
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

test("il KPI disponibile non diventa negativo", () => {
  const summary = warehouseSummary([{ codice_articolo: "MP001", giacenza: 5, disponibilita: -8, costo_ultimo: 4 }]);
  assert.equal(summary.stockValue, 20);
  assert.equal(summary.availableValue, 0);
});

test("un articolo aggregato conserva il dettaglio reale per ogni magazzino", () => {
  const row = warehouseRow({ codice_articolo: "MP001", costo_ultimo: 2, warehouse_details: [
    { warehouse_number: 1, on_hand: 4, committed: 1, available: 3, unit_cost: 2 },
    { warehouse_number: 5, on_hand: 6, committed: 2, available: 4, unit_cost: 2 },
  ] });
  assert.equal(row.warehouse, "Aggregato");
  assert.equal(row.onHand, 10);
  assert.equal(row.warehouseDetails.length, 2);
  const mag5 = warehouseScopedRows([row], "MAG-5");
  assert.equal(mag5.length, 1);
  assert.equal(mag5[0].onHand, 6);
  assert.equal(warehouseSummary(nonNegativeWarehouseRows(mag5)).stockValue, 12);
  assert.equal(warehouseSummary(nonNegativeWarehouseRows(mag5)).availableValue, 8);
  assert.equal(warehouseBreakdown(nonNegativeWarehouseRows(warehouseScopedRows([row]))).byWarehouse.length, 2);
});

test("i magazzini sono accettati solo dal catalogo GET Mexal reale", () => {
  const help = { risorse: [{ regexp: "^/dati-generali/magazzini$", descrizione: "Magazzini aziendali", method: "GET" }] };
  assert.equal(discoverWarehouseCollection(help), "/dati-generali/magazzini");
  assert.deepEqual(normalizeMexalWarehouse({ id_magazzino: 5, descrizione: "Principale" }), { number: 5, name: "Principale" });
  assert.throws(() => discoverWarehouseCollection({ risorse: [] }), /univoca/);
});

test("il progressivo per magazzino non cambia il contratto disponibilità prodotti", () => {
  assert.equal(getAvailabilityWarehouse("IT001"), 5);
  assert.equal(getAvailabilityWarehouse("MKT001"), 5);
  assert.equal(getAvailabilityWarehouse("MP001"), null);
  const mapped = mapArticleWarehouseStock({ codice: "MKT001", qta_inventario: 10, qta_carico: 2, qta_scarico: 1, impegnato: 3, costo_ult: 4, um_principale: "PZ" }, { number: 7, name: "Secondario" }, { syncRunId: 42, synchronizedAt: "2026-08-29T08:00:00.000Z" });
  assert.equal(mapped.article_code, "MKT001");
  assert.equal(mapped.warehouse_number, 7);
  assert.equal(mapped.on_hand, 11);
  assert.equal(mapped.unit_cost, 4);
});
