import test from "node:test";
import assert from "node:assert/strict";
import { filterDashboardOrders } from "../src/modules/orders/services/dashboardOrders.js";

const orders = [
  { id: "1", stato: "aperto", numero_ordine: "ORD-01", ragione_sociale_cliente: "Alfa", numero_ocm: "OCM/12", documenti_mexal: [{ numero: "OCI/88" }] },
  { id: "2", stato: "evaso", numero_ordine: "ORD-02", ragione_sociale_cliente: "Beta", numero_ocx: "OCX/32" },
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
