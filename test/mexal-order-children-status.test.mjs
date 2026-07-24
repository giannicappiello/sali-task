import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { isMissingMexalDocument, isOrderFullyEvicted } from "../server/mexal/sync-order-documents.js";
import { getOrderDisplayStatus } from "../src/modules/orders/services/orderDisplayStatus.js";

const detail = fs.readFileSync(new URL("../src/modules/orders/pages/OrderDetail.jsx", import.meta.url), "utf8");
const fulfillment = fs.readFileSync(new URL("../src/modules/orders/services/orderFulfillment.js", import.meta.url), "utf8");
const migration = fs.readFileSync(new URL("../supabase/migrations/20260724220000_order_children_status_and_lines.sql", import.meta.url), "utf8");
const synchronization = fs.readFileSync(new URL("../server/mexal/sync-order-documents.js", import.meta.url), "utf8");
const submission = fs.readFileSync(new URL("../api/mexal/submit-order.js", import.meta.url), "utf8");

test("riconosce la risorsa Mexal 1004 come documento non più presente", () => {
  const error = Object.assign(new Error("/documenti/ordini-clienti: HTTP 400"), {
    status: 400,
    mexalResponse: {
      status: 400,
      body: JSON.stringify({ error: { "response-code": 1004, "response-detail": "La risorsa specificata non è stata trovata" } }),
    },
  });
  assert.equal(isMissingMexalDocument(error), true);
  assert.equal(isMissingMexalDocument(Object.assign(new Error("Timeout"), { status: 500 })), false);
});

test("un ordine è evaso soltanto quando tutti i suoi documenti figli sono evasi", () => {
  assert.equal(isOrderFullyEvicted([
    { numero: "10", stato_operativo: "EVASO", presente_in_mexal: false },
    { numero: "11", stato_operativo: "EVASO", presente_in_mexal: false },
  ]), true);
  assert.equal(isOrderFullyEvicted([
    { numero: "10", stato_operativo: "EVASO", presente_in_mexal: false },
    { numero: "11", stato_operativo: "APERTO", presente_in_mexal: true },
  ]), false);
});

test("lo stato condiviso mostra EVASO anche se restano i numeri legacy sulla testata", () => {
  assert.deepEqual(getOrderDisplayStatus({
    stato: "confermato",
    stato_sincronizzazione: "completato",
    numero_ocm: "100",
    documenti_mexal: [{ id: "doc-1", numero: "100", stato_operativo: "EVASO", presente_in_mexal: false }],
  }), { label: "EVASO", className: "evaso", closed: true });
});

test("il dettaglio carica e mostra prodotti separati per ogni documento figlio", () => {
  assert.match(fulfillment, /ordini_documenti_mexal_righe/);
  assert.match(fulfillment, /righe: linesByDocument/);
  assert.match(detail, /Ordine \{document\.tipo_documento\}/);
  assert.match(detail, /document\.righe/);
  assert.match(detail, /quantita_oci/);
  assert.match(submission, /saveDocumentLines\(admin, createdDocument\.id, classified\[kind\]\)/);
  assert.match(submission, /delete\(\)\.eq\("documento_mexal_id", documentId\)/);
});

test("la sincronizzazione propaga EVASO dal documento figlio all'ordine padre", () => {
  assert.match(synchronization, /updateEvictedParentOrders/);
  assert.match(synchronization, /from\("ordini_testate"\)\.update\(\{ stato: "evaso" \}\)/);
  assert.match(synchronization, /ordini_evasi: parentOrdersEvicted/);
});

test("la migrazione abilita la lettura e ricostruisce OCM OCX OCI senza cancellare ordini", () => {
  assert.match(migration, /authenticated read mexal order documents/);
  assert.match(migration, /authenticated read mexal order document lines/);
  assert.match(migration, /d\.tipo_documento = 'OCM'/);
  assert.match(migration, /d\.tipo_documento = 'OCX'/);
  assert.match(migration, /d\.tipo_documento = 'OCI'/);
  assert.match(migration, /set stato = 'evaso'/);
  assert.doesNotMatch(migration, /delete\s+from\s+public\.ordini_testate/i);
});
