import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  buildConfiguredOrderEmailRecipients,
  buildOrderEmailQueueRows,
  enqueueOrderConfirmationEmails,
  normalizeOrderEmail,
} from "../server/orders/order-email-queue.js";

assert.equal(normalizeOrderEmail(" ORDINI@PROGRE.IT "), "ordini@progre.it");
assert.equal(normalizeOrderEmail("non-valida"), null);

const moduleConfig = {
  invia_email_cliente: true,
  invia_email_agente: true,
  invia_email_responsabile: true,
  backoffice_1_email: "ORDINI@PROGRE.IT",
  backoffice_2_email: "cliente@example.it",
};
const recipients = buildConfiguredOrderEmailRecipients({
  moduleConfig,
  customer: { email: "Cliente@Example.it" },
  agent: { email: "agente@example.it" },
  responsible: { email: "responsabile@example.it" },
});
assert.deepEqual(recipients, [
  { type: "cliente", email: "cliente@example.it" },
  { type: "agente", email: "agente@example.it" },
  { type: "responsabile", email: "responsabile@example.it" },
  { type: "backoffice_1", email: "ordini@progre.it" },
], "normalizes, filters and deduplicates configured recipients");

const rows = buildOrderEmailQueueRows({
  order: { id: "ordine-1", numero_ordine_visualizzato: "PR-42", modulo_ordini: "prof" },
  documents: [{ kind: "OCM", numero: "100" }, { kind: "OCX", numero: "101" }],
  recipients,
  moduleConfig,
});
assert.equal(rows.length, 4);
assert.ok(rows.every((row) => row.evento === "mexal_sync_completed" && row.stato === "queued"));
assert.deepEqual(rows[0].allegati, [
  { tipo_documento: "OCM", numero: "100", stato: "da_generare" },
  { tipo_documento: "OCX", numero: "101", stato: "da_generare" },
]);

let queuedRows = null;
let upsertOptions = null;
function queryResult(data) {
  return {
    select() { return this; },
    eq() { return this; },
    async maybeSingle() { return { data, error: null }; },
  };
}
const fakeSupabase = {
  from(table) {
    if (table === "mexal_agenti") {
      return queryResult({ email: "agente@example.it", responsabile_utente_id: "responsabile-1" });
    }
    if (table === "utenti") return queryResult({ email: "responsabile@example.it" });
    if (table === "ordini_email_invio") {
      return {
        upsert(inserted, options) {
          queuedRows = inserted;
          upsertOptions = options;
          return {
            async select() {
              return { data: inserted.map((_, index) => ({ id: index + 1 })), error: null };
            },
          };
        },
      };
    }
    throw new Error(`Tabella inattesa: ${table}`);
  },
};
const queueResult = await enqueueOrderConfirmationEmails({
  supabase: fakeSupabase,
  order: {
    id: "ordine-1",
    numero_ordine_visualizzato: "PR-42",
    modulo_ordini: "prof",
    codice_agente_mexal: "A01",
  },
  customer: { email: "cliente@example.it" },
  moduleConfig,
  documents: [{ kind: "OCM", numero: "100" }],
});
assert.deepEqual(queueResult, { recipients: 4, queued: 4 });
assert.equal(queuedRows.length, 4);
assert.deepEqual(upsertOptions, {
  onConflict: "ordine_id,evento,destinatario",
  ignoreDuplicates: true,
});

const [migration, submitOrder] = await Promise.all([
  readFile("supabase/migrations/20260726120000_order_email_queue.sql", "utf8"),
  readFile("api/mexal/submit-order.js", "utf8"),
]);
assert.match(migration, /unique \(ordine_id, evento, destinatario\)/i);
assert.match(migration, /alter table public\.ordini_email_invio enable row level security/i);
assert.match(submitOrder, /if \(!completed\)[\s\S]*enqueueOrderConfirmationEmails/);
assert.doesNotMatch(submitOrder, /resend|nodemailer|smtp/i);

console.log("order email queue: recipients, idempotency, post-Mexal enqueue and no provider verified");
