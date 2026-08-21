import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("Genera con AI richiede la scelta tra ordine standard e prenotazione", async () => {
  const [dialog, orders, dashboard] = await Promise.all([
    read("src/modules/orders/components/AIOrderTypeDialog.jsx"),
    read("src/modules/orders/pages/Orders.jsx"),
    read("src/modules/orders/pages/OrdersDashboard.jsx"),
  ]);

  assert.match(dialog, /Nuovo ordine/);
  assert.match(dialog, /Ordine prenotazione/);
  assert.match(dialog, /onSelect\("standard"\)/);
  assert.match(dialog, /onSelect\("prenotazione"\)/);
  for (const source of [orders, dashboard]) {
    assert.match(source, /setAITypeDialogOpen\(true\)/);
    assert.match(source, /nuovo-da-documento\?tipo=\$\{type\}/);
    assert.match(source, /<AIOrderTypeDialog/);
    assert.doesNotMatch(source, /aiOrderAllowed/);
    assert.doesNotMatch(source, /ai_order_capabilities/);
  }
});

test("la scelta dell'utente prevale sul tipo di documento rilevato", async () => {
  const source = await read("src/modules/orders/pages/AIOrderImport.jsx");
  assert.match(source, /requestedOrderType/);
  assert.match(source, /location\.search/);
  assert.match(source, /requestedOrderType === "prenotazione" \? "\?tipo=prenotazione" : ""/);
  assert.doesNotMatch(source, /const search = orderType === "OCI"/);
});
