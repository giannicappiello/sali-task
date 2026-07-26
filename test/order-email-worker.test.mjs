import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  createSmtpClient,
  isPermanentSmtpError,
  smtpSettings,
} from "../server/email/smtp-client.js";
import {
  ORDER_EMAIL_LEASE_SECONDS,
  processNextOrderEmailJob,
} from "../server/orders/order-email-job.js";
import { createOrderPdfAttachments } from "../server/orders/order-pdf-server.js";

const environment = {
  SMTP_HOST: "smtps.aruba.it",
  SMTP_PORT: "465",
  SMTP_SECURE: "true",
  SMTP_USER: "gestioneordini@progre.it",
  SMTP_PASSWORD: "secret",
  ORDER_EMAIL_FROM: "gestioneordini@progre.it",
  ORDER_EMAIL_NAME: "Gestione Ordini Progre",
};
const settings = smtpSettings((name) => environment[name]);
assert.deepEqual(settings, {
  host: "smtps.aruba.it",
  port: 465,
  secure: true,
  user: "gestioneordini@progre.it",
  password: "secret",
  fromEmail: "gestioneordini@progre.it",
  fromName: "Gestione Ordini Progre",
});

let transportOptions = null;
let sentMessage = null;
const smtp = createSmtpClient({
  getEnv: (name) => environment[name],
  createTransport(options) {
    transportOptions = options;
    return {
      async sendMail(message) {
        sentMessage = message;
        return {
          messageId: "<message-1@progre.it>",
          accepted: [message.to],
          rejected: [],
          response: "250 OK",
        };
      },
    };
  },
});
const smtpResult = await smtp.send({
  to: "cliente@example.it",
  subject: "Conferma ordine",
  text: "Ordine confermato",
  html: "<p>Ordine confermato</p>",
  attachments: [{ filename: "ordine.pdf", content: new Uint8Array([1, 2, 3]) }],
});
assert.equal(transportOptions.secure, true);
assert.equal(transportOptions.auth.user, "gestioneordini@progre.it");
assert.deepEqual(sentMessage.from, {
  name: "Gestione Ordini Progre",
  address: "gestioneordini@progre.it",
});
assert.equal(smtpResult.provider, "smtp_aruba");
assert.equal(smtpResult.messageId, "<message-1@progre.it>");
assert.equal(isPermanentSmtpError({ code: "EAUTH" }), true);
assert.equal(isPermanentSmtpError({ responseCode: 550 }), true);
assert.equal(isPermanentSmtpError({ responseCode: 451 }), false);

const lifecycleCalls = [];
const claimedEmail = {
  id: 12,
  ordine_id: "ordine-12",
  tipo_destinatario: "cliente",
  destinatario: "cliente@example.it",
  oggetto: "Conferma ordine",
  corpo: "Gentile Cliente,\nRiga due <sicura>.",
  lock_token: "lock-12",
};
const lifecycleSupabase = {
  async rpc(name, values) {
    lifecycleCalls.push({ name, values });
    if (name === "claim_next_order_email") return { data: [claimedEmail], error: null };
    return { data: claimedEmail, error: null };
  },
};
const sentPayloads = [];
const lifecycleLogs = [];
const lifecycleResult = await processNextOrderEmailJob({
  supabase: lifecycleSupabase,
  smtp: {
    async send(payload) {
      sentPayloads.push(payload);
      return { provider: "smtp_aruba", messageId: "message-12" };
    },
  },
  workerId: "worker-12",
  logger: {
    log(message) { lifecycleLogs.push(message); },
    error(message) { lifecycleLogs.push(message); },
  },
  async loadEmailData() {
    return {
      order: { id: "ordine-12", numero_ordine_visualizzato: "12/2026" },
      attachments: [{ filename: "ordine.pdf", content: new Uint8Array([1]) }],
    };
  },
});
assert.deepEqual(lifecycleResult, {
  status: "sent",
  emailId: 12,
  messageId: "message-12",
});
assert.equal(lifecycleCalls[0].name, "claim_next_order_email");
assert.deepEqual(lifecycleCalls[0].values, {
  p_worker_id: "worker-12",
  p_lease_seconds: ORDER_EMAIL_LEASE_SECONDS,
});
assert.equal(lifecycleCalls[1].name, "complete_order_email");
assert.equal(sentPayloads[0].to, "cliente@example.it");
assert.equal(sentPayloads[0].text, "Gentile Cliente,\nRiga due <sicura>.");
assert.equal(sentPayloads[0].html, "<p>Gentile Cliente,<br>Riga due &lt;sicura&gt;.</p>");
assert.equal(lifecycleLogs.some((entry) => entry.includes("order_email_sent")), true);

const legacyPayloads = [];
const legacyResult = await processNextOrderEmailJob({
  supabase: {
    async rpc(name) {
      if (name === "claim_next_order_email") {
        return {
          data: [{ ...claimedEmail, id: 13, corpo: null, lock_token: "lock-13" }],
          error: null,
        };
      }
      return { data: null, error: null };
    },
  },
  smtp: {
    async send(payload) {
      legacyPayloads.push(payload);
      return { provider: "smtp_aruba", messageId: "message-13" };
    },
  },
  workerId: "worker-legacy",
  logger: { log() {}, error() {} },
  async loadEmailData() {
    return {
      order: { id: "ordine-13", numero_ordine_visualizzato: "13/2026" },
      attachments: [],
    };
  },
});
assert.equal(legacyResult.status, "sent");
assert.match(legacyPayloads[0].text, /13\/2026/);
assert.match(legacyPayloads[0].html, /13\/2026/);

const retryCalls = [];
const temporaryError = Object.assign(new Error("SMTP temporaneamente non disponibile"), {
  responseCode: 451,
});
const retryResult = await processNextOrderEmailJob({
  supabase: {
    async rpc(name, values) {
      retryCalls.push({ name, values });
      if (name === "claim_next_order_email") return { data: [claimedEmail], error: null };
      return { data: claimedEmail, error: null };
    },
  },
  smtp: {
    async send() {
      throw temporaryError;
    },
  },
  workerId: "worker-retry",
  logger: { log() {}, error() {} },
  async loadEmailData() {
    return {
      order: { id: "ordine-12" },
      attachments: [],
    };
  },
});
assert.deepEqual(retryResult, {
  status: "error",
  error: "SMTP temporaneamente non disponibile",
});
assert.equal(retryCalls[1].name, "retry_order_email");
assert.equal(retryCalls[1].values.p_permanent, false);

const idleResult = await processNextOrderEmailJob({
  supabase: {
    async rpc(name) {
      assert.equal(name, "claim_next_order_email");
      return { data: [], error: null };
    },
  },
  smtp: { async send() { assert.fail("SMTP non deve partire senza job."); } },
  workerId: "worker-idle",
  logger: { log() {}, error() {} },
});
assert.deepEqual(idleResult, { status: "idle", workerId: "worker-idle" });

const missingLockCalls = [];
const missingLockResult = await processNextOrderEmailJob({
  supabase: {
    async rpc(name) {
      missingLockCalls.push(name);
      return { data: [{ ...claimedEmail, lock_token: null }], error: null };
    },
  },
  smtp: { async send() { assert.fail("SMTP non deve partire senza lock_token."); } },
  workerId: "worker-missing-lock",
  logger: { log() {}, error() {} },
  async loadEmailData() {
    assert.fail("Il PDF non deve essere caricato senza lock_token.");
  },
});
assert.deepEqual(missingLockResult, {
  status: "error",
  error: "lock_token email mancante",
});
assert.deepEqual(missingLockCalls, ["claim_next_order_email"]);

const attachments = await createOrderPdfAttachments({
  order: {
    id: "ordine-1",
    data_ordine: "2026-07-26",
    numero_ordine_visualizzato: "10/2026",
  },
  lines: [{
    codice_articolo: "ART-1",
    descrizione: "Articolo",
    quantita: 2,
    quantita_ocm: 2,
    prezzo_listino: 10,
    aliquota_iva: 22,
  }],
  documents: [{ tipo_documento: "OCM", serie: 1, numero: 100 }],
});
assert.equal(attachments.length, 1);
assert.equal(attachments[0].filename, "ordine-OCM-1-100.pdf");
assert.equal(attachments[0].contentType, "application/pdf");
assert.ok(attachments[0].content.byteLength > 100);

const workspaceAttachments = await createOrderPdfAttachments({
  order: {
    id: "ordine-2",
    data_ordine: "2026-07-26",
    numero_ordine_visualizzato: "11/2026",
  },
  lines: [{
    codice_articolo: "ART-2",
    descrizione: "Articolo Workspace",
    quantita: 1,
    prezzo_listino: 15,
    aliquota_iva: 22,
  }],
  documents: [],
});
assert.equal(workspaceAttachments.length, 1);
assert.equal(workspaceAttachments[0].filename, "ordine-workspace-11-2026.pdf");
assert.ok(workspaceAttachments[0].content.byteLength > 100);

const [migration, worker, sharedJob, config, envExample] = await Promise.all([
  readFile("supabase/migrations/20260726130000_order_email_worker_rpcs.sql", "utf8"),
  readFile("supabase/functions/order-email-worker/index.ts", "utf8"),
  readFile("server/orders/order-email-job.js", "utf8"),
  readFile("supabase/config.toml", "utf8"),
  readFile(".env.example", "utf8"),
]);
assert.match(migration, /create or replace function public\.claim_next_order_email/);
assert.match(migration, /for update skip locked/i);
assert.match(migration, /security definer[\s\S]*set search_path = pg_catalog, public, pg_temp/i);
assert.match(migration, /complete_order_email[\s\S]*provider_message_id/);
assert.match(migration, /retry_order_email[\s\S]*'failed'[\s\S]*'retry'/);
assert.match(migration, /order-email-worker-every-minute/);
assert.match(worker, /processNextOrderEmailJob/);
assert.match(worker, /x-order-email-worker-secret/);
assert.match(sharedJob, /claim_next_order_email/);
assert.match(sharedJob, /loadOrderPdfEmailData/);
assert.match(sharedJob, /complete_order_email/);
assert.match(sharedJob, /retry_order_email/);
assert.match(config, /\[functions\.order-email-worker\][\s\S]*verify_jwt = false/);
for (const name of Object.keys(environment)) assert.match(envExample, new RegExp(`^${name}=`, "m"));

console.log("order email worker: SMTP, PDF, leases, lifecycle, cron and secrets verified");
