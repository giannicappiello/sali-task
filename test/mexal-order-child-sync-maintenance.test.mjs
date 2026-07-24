import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const migration = fs.readFileSync(new URL("../supabase/migrations/20260724190000_mexal_order_children_sync_maintenance.sql", import.meta.url), "utf8");
const automation = fs.readFileSync(new URL("../api/mexal/automation.js", import.meta.url), "utf8");
const dispatcher = fs.readFileSync(new URL("../api/cron/mexal-dispatcher.js", import.meta.url), "utf8");
const submitOrder = fs.readFileSync(new URL("../api/mexal/submit-order.js", import.meta.url), "utf8");
const maintenance = fs.readFileSync(new URL("../src/modules/integrations/components/MexalOrderMaintenance.jsx", import.meta.url), "utf8");

test("la migrazione modella documenti e righe figli per entrambi i moduli", () => {
  assert.match(migration, /ordini_documenti_mexal_righe/);
  assert.match(migration, /ORDINIPH/);
  assert.match(migration, /ORDINIPR/);
  assert.match(migration, /APERTO.*EVASO.*ANNULLATO.*ERRORE/s);
  assert.match(migration, /on delete cascade/i);
});

test("invio e automazione persistono righe e riconciliano gli ordini senza nuove API", () => {
  assert.match(submitOrder, /saveDocumentLines/);
  assert.match(submitOrder, /stato_operativo: "APERTO"/);
  assert.match(automation, /orders: orderDocumentsHandler/);
  assert.match(dispatcher, /syncType: "orders"/);
});

test("manutenzione richiede conferma e dichiara la cancellazione solo Workspace", () => {
  assert.match(maintenance, /window\.confirm/);
  assert.match(maintenance, /SOLO da Workspace/);
  assert.match(maintenance, /Mexal non verrà modificato/);
  assert.match(automation, /order_maintenance_purge/);
});
