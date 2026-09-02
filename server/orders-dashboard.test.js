import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { filterDashboardOrders } from "../src/modules/orders/services/dashboardOrders.js";

const orders = [
  { id: "1", stato: "aperto", data_ordine: "2026-07-12", numero_ordine: "ORD-01", ragione_sociale_cliente: "Alfa", numero_ocm: "OCM/12", documenti_mexal: [{ numero: "OCI/88" }] },
  { id: "2", stato: "evaso", data_ordine: "2026-08-03", numero_ordine: "ORD-02", ragione_sociale_cliente: "Beta", numero_ocx: "OCX/32" },
];

test("la ricerca dashboard include stato e documenti Mexal", () => {
  assert.deepEqual(filterDashboardOrders(orders, "evaso", "").map(({ id }) => id), ["2"]);
  assert.deepEqual(filterDashboardOrders(orders, "oci/88", "").map(({ id }) => id), ["1"]);
  assert.deepEqual(filterDashboardOrders(orders, "ocx/32", "").map(({ id }) => id), ["2"]);
});

test("il filtro card limita gli ordini allo stato selezionato", () => {
  assert.deepEqual(filterDashboardOrders(orders, "", "aperto").map(({ id }) => id), ["1"]);
  assert.equal(filterDashboardOrders(orders, "", "").length, 2);
});

test("il filtro mese si combina con ricerca e stato", () => {
  assert.deepEqual(filterDashboardOrders(orders, "", "", "2026-07").map(({ id }) => id), ["1"]);
  assert.deepEqual(filterDashboardOrders(orders, "", "evaso", "2026-08").map(({ id }) => id), ["2"]);
  assert.equal(filterDashboardOrders(orders, "alfa", "", "2026-08").length, 0);
});

test("la card Ordini del mese applica il filtro del mese corrente", async () => {
  const source = await readFile(new URL("../src/modules/orders/pages/OrdersDashboard.jsx", import.meta.url), "utf8");
  assert.match(source, /label="Ordini del mese"[\s\S]*setMonthFilter/);
  assert.match(source, /monthFilter === currentMonth/);
});
