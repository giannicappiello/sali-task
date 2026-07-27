import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  buildConfiguredOrderEmailRecipients,
  buildOrderEmailQueueRows,
  confirmationEmailAvailableAt,
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
  email_cliente_oggetto_template: "Cliente {numero_ordine}",
  email_cliente_corpo_template: "Gentile {cliente}: totale {totale}.",
  email_agente_oggetto_template: "Agente {numero_ordine}",
  email_agente_corpo_template: "Ciao {agente}: cliente {cliente}.",
  email_backoffice_oggetto_template: "Backoffice {numero_ordine}",
  email_backoffice_corpo_template: "Ordine del {data}: {cliente}, {agente}, {totale}.",
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
  order: {
    id: "ordine-1",
    numero_ordine_visualizzato: "PR-42",
    modulo_ordini: "prof",
    data_ordine: "2026-07-26",
    totale_documento: 100,
  },
  customer: { ragione_sociale: "Cliente Uno" },
  agent: { nome: "Ada", cognome: "Agente" },
  documents: [{ kind: "OCM", numero: "100" }, { kind: "OCX", numero: "101" }],
  recipients,
  moduleConfig,
});
assert.equal(rows.length, 4);
assert.ok(rows.every((row) => row.evento === "order_confirmed" && row.stato === "queued"));
assert.equal(rows[0].oggetto, "Cliente PR-42");
assert.match(rows[0].corpo, /Gentile Cliente Uno: totale 100,00/);
assert.equal(rows[1].oggetto, "Agente PR-42");
assert.match(rows[1].corpo, /Ciao Ada Agente/);
assert.equal(rows[2].oggetto, "Backoffice PR-42");
assert.match(rows[2].corpo, /26\/07\/2026/);
assert.equal(
  rows[0].config_snapshot.email_templates.email_cliente_oggetto_template,
  moduleConfig.email_cliente_oggetto_template,
);
assert.deepEqual(rows[0].allegati, [
  { tipo_documento: "OCM", numero: "100", stato: "da_generare" },
  { tipo_documento: "OCX", numero: "101", stato: "da_generare" },
]);

let queuedRows = null;
let upsertOptions = null;
let releasedUpdate = null;
let queueWriteCount = 0;
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
      return queryResult({
        nome: "Ada",
        cognome: "Agente",
        email: "agente@example.it",
        responsabile_utente_id: "responsabile-1",
      });
    }
    if (table === "utenti") return queryResult({ email: "responsabile@example.it" });
    if (table === "ordini_email_invio") {
      return {
        upsert(inserted, options) {
          queuedRows = inserted;
          upsertOptions = options;
          queueWriteCount += 1;
          return {
            async select() {
              return {
                data: queueWriteCount === 1
                  ? inserted.map((_, index) => ({ id: index + 1 }))
                  : [],
                error: null,
              };
            },
          };
        },
        update(values) {
          releasedUpdate = values;
          return {
            eq() { return this; },
            in() { return this; },
            async select() {
              return {
                data: queuedRows.map((_, index) => ({ id: index + 1 })),
                error: null,
              };
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
    data_ordine: "2026-07-26",
    totale_documento: 100,
  },
  customer: { email: "cliente@example.it", ragione_sociale: "Cliente Uno" },
  moduleConfig,
  documents: [{ kind: "OCM", numero: "100" }],
});
assert.deepEqual(queueResult, {
  recipients: 4,
  queued: 4,
  released: 0,
  dispatch: { status: "not_configured" },
});
assert.equal(queuedRows.length, 4);
assert.ok(queuedRows.every((row) => row.corpo && row.oggetto));
assert.deepEqual(upsertOptions, {
  onConflict: "ordine_id,evento,destinatario",
  ignoreDuplicates: true,
});
const reconciledQueueResult = await enqueueOrderConfirmationEmails({
  supabase: fakeSupabase,
  order: {
    id: "ordine-1",
    numero_ordine_visualizzato: "PR-42",
    modulo_ordini: "prof",
    codice_agente_mexal: "A01",
    data_ordine: "2026-07-26",
    totale_documento: 100,
  },
  customer: { email: "cliente@example.it", ragione_sociale: "Cliente Uno" },
  moduleConfig,
  documents: [{ kind: "OCM", numero: "100" }],
  releaseExisting: true,
});
assert.deepEqual(reconciledQueueResult, {
  recipients: 4,
  queued: 0,
  released: 4,
  dispatch: { status: "not_configured" },
});
assert.equal(releasedUpdate.last_error, null);
assert.deepEqual(releasedUpdate.allegati, [
  { tipo_documento: "OCM", numero: "100", stato: "da_generare" },
]);
assert.equal(
  confirmationEmailAvailableAt({ invia_automaticamente_mexal: false }, 0),
  "1970-01-01T00:00:00.000Z",
);
assert.ok(
  Date.parse(confirmationEmailAvailableAt({ invia_automaticamente_mexal: true }, 0)) > 0,
);

const [migration, submitOrder, newOrder, fulfillment, enqueueApi] = await Promise.all([
  readFile("supabase/migrations/20260726120000_order_email_queue.sql", "utf8"),
  readFile("api/mexal/submit-order.js", "utf8"),
  readFile("src/modules/orders/pages/NewOrder.jsx", "utf8"),
  readFile("src/modules/orders/services/orderFulfillment.js", "utf8"),
  readFile("api/mexal/orders/enqueue-confirmation-emails.js", "utf8"),
]);
assert.match(migration, /unique \(ordine_id, evento, destinatario\)/i);
assert.match(migration, /alter table public\.ordini_email_invio enable row level security/i);
assert.match(submitOrder, /if \(!completed\)[\s\S]*enqueueOrderConfirmationEmails/);
assert.doesNotMatch(submitOrder, /resend|nodemailer|smtp/i);
assert.match(newOrder, /conferma_ordine_workspace[\s\S]*enqueueOrderConfirmationEmail\(order\.id, moduleCode\)[\s\S]*submitOrderToMexal/);
assert.match(fulfillment, /enqueueOrderConfirmationEmail[\s\S]*\/api\/mexal\/orders\/enqueue-confirmation-emails/);
assert.match(enqueueApi, /verifyUser[\s\S]*loadOrderConfirmationEmailContext[\s\S]*enqueueOrderConfirmationEmails/);

console.log("order email queue: confirmation enqueue, recipients, idempotency and Mexal reconciliation verified");
