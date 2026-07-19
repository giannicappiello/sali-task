import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [module, orders, newOrder, detail] = await Promise.all([
  readFile("src/modules/orders/OrdersModule.jsx", "utf8"),
  readFile("src/modules/orders/pages/Orders.jsx", "utf8"),
  readFile("src/modules/orders/pages/NewOrder.jsx", "utf8"),
  readFile("src/modules/orders/pages/OrderDetail.jsx", "utf8"),
]);

for (const source of [module, orders, newOrder, detail]) {
  assert.doesNotMatch(source, /sync-products|sync-clients|sync-stock-it|runMexalEventAutomation|startAutomaticOrderSyncs|startOrderSync/);
}
assert.match(newOrder, /I dati Mexal non sono disponibili/);
assert.match(newOrder, /Eseguire la sincronizzazione dal pannello Integrazioni/);
console.log("orders pages only read cache and never start Mexal synchronizations");
