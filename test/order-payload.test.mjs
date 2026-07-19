import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  buildNewOrderInsertPayload,
  buildWritableOrderPayload,
} from "../src/modules/orders/services/orderPayload.js";

const customer = {
  codice_cliente: "C-001",
  ragione_sociale: "Cliente di prova",
  codice_agente_mexal: "A-01",
  codice_pagamento: "RIBA",
  codice_listino: "L-01",
  indirizzo: "Via Roma 1",
  cap: "20100",
  localita: "Milano",
  provincia: "MI",
};

const insertPayload = buildNewOrderInsertPayload({
  dataOrdine: "2026-07-19",
  customer,
  agentCode: "A-fallback",
  payment: { codice: "BON", descrizione: "Bonifico" },
  paymentDescription: () => "non usato",
  comments: "  consegna mattina  ",
  total: 123.45,
});

assert.equal(insertPayload.data_ordine, "2026-07-19", "mantiene la data sorgente scrivibile");
assert.deepEqual(insertPayload, {
  data_ordine: "2026-07-19",
  stato: "bozza",
  codice_cliente: "C-001",
  ragione_sociale_cliente: "Cliente di prova",
  codice_agente_mexal: "A-01",
  codice_pagamento: "BON",
  descrizione_pagamento: "Bonifico",
  codice_listino: "L-01",
  indirizzo_spedizione: "Via Roma 1 20100 Milano MI",
  commenti: "consegna mattina",
  totale: 123.45,
}, "conserva tutti i campi necessari dell'ordine");
assert.equal("mese_ordine" in insertPayload, false, "l'insert non invia la colonna generated");

const recordReadFromSupabase = {
  ...insertPayload,
  id: "a-generated-id",
  created_at: "2026-07-19T09:00:00Z",
  mese_ordine: "2026-07",
  another_generated_column: "read only",
  note_mexal: "Workspace n. a-generated-id",
};
const upsertPayload = buildWritableOrderPayload(recordReadFromSupabase);
assert.equal("mese_ordine" in upsertPayload, false, "l'upsert non invia mese_ordine");
assert.equal("id" in upsertPayload, false, "l'upsert elimina le colonne di sola lettura");
assert.equal("another_generated_column" in upsertPayload, false, "l'upsert elimina le altre colonne generate");
assert.equal(upsertPayload.data_ordine, "2026-07-19");
assert.equal(upsertPayload.codice_cliente, "C-001");

const updatePayload = buildWritableOrderPayload(recordReadFromSupabase);
assert.deepEqual(updatePayload, upsertPayload, "l'update da un record letto usa la stessa allow-list");
assert.equal("mese_ordine" in updatePayload, false, "l'update/conferma non invia mese_ordine");

const newOrderSource = await readFile("src/modules/orders/pages/NewOrder.jsx", "utf8");
assert.match(newOrderSource, /\.insert\(orderPayload\)/);
assert.match(newOrderSource, /buildWritableOrderPayload\(\{ note_mexal: noteMexal \}\)/);
assert.match(newOrderSource, /await supabase\.rpc\([\s\S]*conferma_ordine_workspace[\s\S]*submitOrderToMexal\(order\.id\)/,
  "dopo la conferma il flusso prosegue verso la preparazione Mexal");
assert.doesNotMatch(newOrderSource, /mese_ordine\s*:/,
  "New Order non costruisce più un payload con mese_ordine");

console.log("order payload: generated columns are excluded from insert, upsert, and update payloads");
