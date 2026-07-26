import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  ORDER_EMAIL_PLACEHOLDERS,
  buildOrderEmailTemplateValues,
  orderEmailTemplateCategory,
  resolveOrderEmailContent,
  validateOrderEmailTemplate,
} from "../server/orders/order-email-template.js";

const values = buildOrderEmailTemplateValues({
  order: {
    id: "ordine-42",
    numero_ordine_visualizzato: "42/2026",
    data_ordine: "2026-07-26",
    totale_documento: 1234.5,
    codice_cliente: "CLI-1",
  },
  customer: { ragione_sociale: "Cliente Test" },
  agent: { nome: "Mario", cognome: "Rossi" },
});

assert.deepEqual(ORDER_EMAIL_PLACEHOLDERS, [
  "{cliente}",
  "{numero_ordine}",
  "{data}",
  "{agente}",
  "{totale}",
]);
assert.equal(values.cliente, "Cliente Test");
assert.equal(values.numero_ordine, "42/2026");
assert.equal(values.data, "26/07/2026");
assert.equal(values.agente, "Mario Rossi");
assert.match(values.totale, /1\.?234,50/);

const content = resolveOrderEmailContent({
  moduleConfig: {
    email_cliente_oggetto_template: "Ordine {numero_ordine} per {cliente}",
    email_cliente_corpo_template: "Data {data}; agente {agente}; totale {totale}.",
  },
  recipientType: "cliente",
  values,
});
assert.equal(content.subject, "Ordine 42/2026 per Cliente Test");
assert.match(content.body, /Data 26\/07\/2026; agente Mario Rossi; totale 1\.?234,50/);
assert.equal(orderEmailTemplateCategory("responsabile"), "backoffice");
assert.throws(
  () => validateOrderEmailTemplate("Ordine {placeholder_inesistente}"),
  /placeholder non supportati/,
);
assert.throws(() => validateOrderEmailTemplate("   "), /obbligatorio/);

const migration = await readFile(
  "supabase/migrations/20260726150000_order_email_templates.sql",
  "utf8",
);
for (const column of [
  "email_cliente_oggetto_template",
  "email_cliente_corpo_template",
  "email_agente_oggetto_template",
  "email_agente_corpo_template",
  "email_backoffice_oggetto_template",
  "email_backoffice_corpo_template",
]) {
  assert.match(migration, new RegExp(`add column if not exists ${column}`));
}
assert.match(migration, /alter table public\.ordini_email_invio[\s\S]*add column if not exists corpo text/i);

console.log("order email templates: placeholders, rendering, validation and migration verified");
