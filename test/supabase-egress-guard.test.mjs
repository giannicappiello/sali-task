import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Workspace startup preloads compact Order data instead of full customer payloads", async () => {
  const preloader = await read("src/components/OrdersDataPreloader.jsx");
  const selections = await read("src/modules/orders/services/orderDataSelections.js");

  assert.match(preloader, /installOrderDataFetchCache/);
  assert.match(preloader, /ORDER_CUSTOMER_COLUMNS/);
  assert.match(preloader, /visible_mexal_clients_for_me/);
  assert.doesNotMatch(selections, /dati_mexal|json_mexal/);
});

test("Orders cache survives access-token refreshes while remaining isolated per user", async () => {
  const cache = await read("src/modules/orders/services/orderDataFetchCache.js");

  assert.match(cache, /function authorizationScope/);
  assert.match(cache, /JSON\.parse\(atob\(base64\)\)\?\.sub/);
  assert.match(cache, /authorizationScope\(authorization\)/);
});

test("New Order reuses the same compact customer query warmed by the preloader", async () => {
  const newOrder = await read("src/modules/orders/pages/NewOrder.jsx");

  assert.match(newOrder, /loadPaged\("ordini_clienti_cache"[\s\S]*ORDER_CUSTOMER_COLUMNS/);
  assert.match(newOrder, /loadPagedRpc\("visible_mexal_clients_for_me"[\s\S]*ORDER_CUSTOMER_COLUMNS/);
  assert.match(newOrder, /paymentDescription\(customer, paymentRules\)/);
});

test("Invoice analysis excludes the large raw header payload", async () => {
  const analysis = await read("src/modules/analytics/pages/CommercialPivotAnalysis.jsx");
  const invoiceColumns = analysis.match(/invoices:\s*\{[\s\S]*?columns:\s*"([^"]+)"/)?.[1] || "";

  assert.match(invoiceColumns, /totale_documento/);
  assert.match(invoiceColumns, /causale_magazzino_descrizione/);
  assert.doesNotMatch(invoiceColumns, /dati_mexal/);
});
