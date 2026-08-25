/* global process */
import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { DIGITAL_PROVIDER_REGISTRY, providerDefinition, requiredSecretNames, validateProviderConfiguration } from "../../shared/digitalProviderRegistry.js";
import { requireAdmin, requirePermission } from "../mexal/lib/auth.js";
import { decryptSecret, encryptSecret, maskSecret, redact } from "./digital-security.js";
import { makeSyncIdempotencyKey } from "./digital-connectors.js";
import { testProviderConnection } from "./digital-provider-adapters.js";
import { completeDigitalOAuth, startDigitalOAuth } from "./digital-oauth.js";
import { notifyDigitalAdmins } from "./digital-notifications.js";

const SAFE_CONNECTION_FIELDS = "id,tipo,provider_code,provider,nome,category,auth_type,stato,endpoint_url,site_url,external_account_id,marketplace_ids,configurazione,secret_references,credenziali_stato,abilitata,sync_attivo,sync_frequency,is_default,ultimo_test_il,ultimo_test_stato,ultimo_test_messaggio,errori_consecutivi,ultimo_sync_il,prossima_run_il,ultimo_errore,oauth_scade_il,webhook_path,webhook_stato,ultimo_webhook_il,disabilitata_il,aggiornata_il";

function required(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw Object.assign(new Error(`Configurazione server mancante: ${name}.`), { status: 500 });
  return value;
}

function serviceClient() {
  return createClient(required("SUPABASE_URL"), required("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false, autoRefreshToken: false } });
}

async function authorize(req, adminOnly = false) {
  return (adminOnly ? requireAdmin : requirePermission)(req, serviceClient, adminOnly ? undefined : "integrations.configure");
}

function safeProvider(definition) {
  return { ...definition, secretSchema: definition.secretSchema.map(({ name, label, kind, required: isRequired }) => ({ name, label, kind, required: isRequired })) };
}

async function secretRows(db, connectionId) {
  const { data, error } = await db.from("crm_connection_secrets").select("secret_name,ciphertext,iv,auth_tag,fingerprint,key_version").eq("connection_id", connectionId);
  if (error) throw error;
  return data || [];
}

async function decryptedSecrets(db, connectionId) {
  return Object.fromEntries((await secretRows(db, connectionId)).map((row) => [row.secret_name, decryptSecret(row)]));
}

async function safeConnection(db, connection) {
  const masks = Object.fromEntries((await secretRows(db, connection.id)).map((row) => [row.secret_name, maskSecret(row)]));
  return { ...connection, secrets: masks, secret_references: Object.keys(masks), canRevealSecrets: false };
}

async function connectionById(db, id) {
  const { data, error } = await db.from("crm_external_connections").select(SAFE_CONNECTION_FIELDS).eq("id", id).single();
  if (error) throw Object.assign(error, { status: error.code === "PGRST116" ? 404 : 500 });
  return data;
}

async function audit(db, actorId, connection, operation, outcome = "success", details = {}) {
  const safeDetails = redact({ changed_field_count: Object.keys(details.fields || {}).length, reason: details.reason, status: details.status, count: details.count });
  const { error } = await db.from("crm_connection_audit").insert({ connection_id: connection?.id || null, provider_code: connection?.provider_code || null, operation, actor_id: actorId || null, outcome, details: safeDetails });
  if (error) throw error;
}

async function list(db) {
  const { data, error } = await db.from("crm_external_connections").select(SAFE_CONNECTION_FIELDS).order("category").order("nome");
  if (error) throw error;
  return Promise.all((data || []).map((row) => safeConnection(db, row)));
}

function normalizePayload(body) {
  const definition = providerDefinition(body.providerCode);
  if (!definition) throw Object.assign(new Error("Provider non supportato."), { status: 400 });
  const configuration = validateProviderConfiguration(definition, body.configuration || {});
  const authType = String(body.authType || definition.authType);
  if (!definition.authOptions.includes(authType)) throw Object.assign(new Error("Metodo di autenticazione non supportato."), { status: 400 });
  return { definition, configuration, authType };
}

async function save(req, body) {
  const auth = await authorize(req, true);
  const { definition, configuration, authType } = normalizePayload(body);
  const secrets = body.secrets && typeof body.secrets === "object" ? body.secrets : {};
  const unknownSecret = Object.keys(secrets).find((name) => !definition.secretSchema.some((item) => item.name === name));
  if (unknownSecret) throw Object.assign(new Error("Campo credenziale non previsto."), { status: 400 });
  const payload = {
    tipo: definition.providerType, provider_code: definition.providerCode, provider: definition.displayName,
    nome: String(body.name || definition.displayName).trim(), category: definition.category, auth_type: authType,
    stato: "da_verificare", credenziali_stato: "mancanti", abilitata: false, sync_attivo: false,
    sync_frequency: body.syncFrequency === "daily" ? "daily" : "manual", is_default: Boolean(body.isDefault),
    endpoint_url: configuration.base_url || null, site_url: configuration.site_url || null,
    external_account_id: configuration.account_id || configuration.seller_id || configuration.customer_id || null,
    marketplace_ids: configuration.marketplace_ids || [], configurazione: configuration,
    secret_references: [], errori_consecutivi: 0, aggiornata_da: auth.id, aggiornata_il: new Date().toISOString(),
  };
  let connection;
  if (body.id) {
    const current = await connectionById(auth.supabase, body.id);
    const { data, error } = await auth.supabase.from("crm_external_connections").update(payload).eq("id", current.id).select(SAFE_CONNECTION_FIELDS).single();
    if (error) throw error; connection = data;
  } else {
    const { data, error } = await auth.supabase.from("crm_external_connections").insert({ ...payload, creata_da: auth.id }).select(SAFE_CONNECTION_FIELDS).single();
    if (error) throw error; connection = data;
  }
  for (const [name, value] of Object.entries(secrets)) {
    if (!String(value || "")) continue;
    const encrypted = encryptSecret(value);
    const { error } = await auth.supabase.from("crm_connection_secrets").upsert({ connection_id: connection.id, secret_name: name, ...encrypted, aggiornata_da: auth.id, aggiornata_il: new Date().toISOString() });
    if (error) throw error;
  }
  if (Object.values(secrets).some((value) => String(value || ""))) await audit(auth.supabase, auth.id, connection, "credential.updated", "success", { count: Object.values(secrets).filter((value) => String(value || "")).length });
  const rows = await secretRows(auth.supabase, connection.id);
  const names = rows.map((row) => row.secret_name);
  const missing = requiredSecretNames(definition).filter((name) => !names.includes(name));
  const state = missing.length ? "configurazione_parziale" : "da_verificare";
  const { data, error } = await auth.supabase.from("crm_external_connections").update({ stato: state, credenziali_stato: missing.length ? "parziali" : "configurate", secret_references: names }).eq("id", connection.id).select(SAFE_CONNECTION_FIELDS).single();
  if (error) throw error;
  await audit(auth.supabase, auth.id, data, body.id ? "connection.updated" : "connection.created", "success", { fields: payload });
  return { connection: await safeConnection(auth.supabase, data), missingSecrets: missing };
}

async function revokeSecret(req, body) {
  const auth = await authorize(req, true); const connection = await connectionById(auth.supabase, body.id);
  const definition = providerDefinition(connection.provider_code);
  if (!definition?.secretSchema.some((item) => item.name === body.secretName)) throw Object.assign(new Error("Credenziale non prevista."), { status: 400 });
  const { error } = await auth.supabase.from("crm_connection_secrets").delete().eq("connection_id", connection.id).eq("secret_name", body.secretName);
  if (error) throw error;
  const rows = await secretRows(auth.supabase, connection.id); const names = rows.map((row) => row.secret_name);
  await auth.supabase.from("crm_external_connections").update({ secret_references: names, credenziali_stato: "parziali", stato: "configurazione_parziale", abilitata: false, sync_attivo: false }).eq("id", connection.id);
  await audit(auth.supabase, auth.id, connection, "credential.revoked", "success", { fields: { secretName: true } });
  return { revoked: true };
}

async function testConnection(req, body) {
  const auth = await authorize(req, true); const connection = await connectionById(auth.supabase, body.id);
  const definition = providerDefinition(connection.provider_code); const secrets = await decryptedSecrets(auth.supabase, connection.id);
  const missing = requiredSecretNames(definition).filter((name) => !secrets[name]);
  if (missing.length) throw Object.assign(new Error("Credenziali obbligatorie incomplete."), { status: 422 });
  try {
    const result = await testProviderConnection(connection, secrets);
    const now = new Date().toISOString();
    await auth.supabase.from("crm_external_connections").update({ stato: "connesso", credenziali_stato: "configurate", ultimo_test_il: now, ultimo_test_stato: "success", ultimo_test_messaggio: result.message, ultimo_errore: null, errori_consecutivi: 0 }).eq("id", connection.id);
    await audit(auth.supabase, auth.id, connection, "connection.tested", "success", { status: "success", count: result.accounts.length });
    return { success: true, message: result.message, accounts: result.accounts.map(({ external_id, nome, tipo, marketplace, valuta }) => ({ external_id, nome, tipo, marketplace, valuta })) };
  } catch (error) {
    const consecutiveErrors = Number(connection.errori_consecutivi || 0) + 1;
    const testStatus = error.code === "provider_403" ? "insufficient_scope" : error.code === "provider_401" ? "expired" : error.status === 504 ? "unreachable" : "failed";
    await auth.supabase.from("crm_external_connections").update({ stato: testStatus === "expired" ? "oauth_scaduto" : "errore", ultimo_test_il: new Date().toISOString(), ultimo_test_stato: testStatus, ultimo_test_messaggio: "Test non riuscito.", ultimo_errore: error.message, errori_consecutivi: consecutiveErrors }).eq("id", connection.id);
    await audit(auth.supabase, auth.id, connection, "connection.tested", "failed", { status: "failed" });
    if (consecutiveErrors >= 2) await notifyDigitalAdmins(auth.supabase, connection, "crm_digital_connection_error").catch(() => null);
    throw error;
  }
}

async function activate(req, body) {
  const auth = await authorize(req, true); const connection = await connectionById(auth.supabase, body.id);
  if (connection.ultimo_test_stato !== "success") throw Object.assign(new Error("Eseguire prima un test connessione con esito positivo."), { status: 409 });
  const now = new Date(); const daily = body.syncFrequency === "daily";
  const { data, error } = await auth.supabase.from("crm_external_connections").update({ abilitata: true, sync_attivo: daily, sync_frequency: daily ? "daily" : "manual", stato: "connesso", disabilitata_il: null, prossima_run_il: daily ? new Date(now.getTime() + 86400000).toISOString() : null }).eq("id", connection.id).select(SAFE_CONNECTION_FIELDS).single();
  if (error) throw error; await audit(auth.supabase, auth.id, data, "connection.activated"); return { connection: await safeConnection(auth.supabase, data) };
}

async function deactivate(req, body) {
  const auth = await authorize(req, true); const connection = await connectionById(auth.supabase, body.id);
  const { error } = await auth.supabase.from("crm_external_connections").update({ abilitata: false, sync_attivo: false, stato: "disabilitato", disabilitata_il: new Date().toISOString(), prossima_run_il: null }).eq("id", connection.id);
  if (error) throw error; await audit(auth.supabase, auth.id, connection, "connection.deactivated"); return { deactivated: true };
}

async function synchronize(db, actorId, connection, mode = "manual") {
  const key = makeSyncIdempotencyKey({ connectionId: connection.id, syncType: "account_discovery", windowStart: mode === "scheduled" ? new Date().toISOString().slice(0, 10) : crypto.randomUUID() });
  const { data: claimedRunId, error: claimError } = await db.rpc("crm_claim_sync_run_service", { target_connection_id: connection.id, target_sync_type: "account_discovery", target_mode: "incremental", target_idempotency_key: key, target_triggered_by: actorId || null });
  if (claimError) throw claimError;
  const claim = { run_id: claimedRunId };
  if (!claim.run_id) throw Object.assign(new Error("Impossibile acquisire il lock di sincronizzazione."), { status: 409 });
  const started = Date.now();
  try {
    const result = await testProviderConnection(connection, await decryptedSecrets(db, connection.id));
    for (const row of result.accounts) {
      const { error } = await db.from("crm_external_accounts").upsert({ connection_id: connection.id, ...row, aggiornato_il: new Date().toISOString() }, { onConflict: "connection_id,external_id" });
      if (error) throw error;
    }
    await db.rpc("crm_complete_sync_run_service", { target_run_id: claim.run_id, target_status: "completed", target_counts: { read: result.accounts.length, inserted: 0, updated: result.accounts.length, failed: 0 }, target_error_code: null, target_error_message: null, target_details: { source: mode, account_count: result.accounts.length } });
    await db.from("crm_external_connections").update({ ultimo_sync_il: new Date().toISOString(), ultimo_errore: null, errori_consecutivi: 0, prossima_run_il: connection.sync_frequency === "daily" ? new Date(Date.now() + 86400000).toISOString() : null }).eq("id", connection.id);
    return { runId: claim.run_id, status: "completed", recordsRead: result.accounts.length, durationMs: Date.now() - started };
  } catch (error) {
    await db.rpc("crm_complete_sync_run_service", { target_run_id: claim.run_id, target_status: "failed", target_counts: { failed: 1 }, target_error_code: error.code || "provider_error", target_error_message: error.message, target_details: { source: mode } });
    const consecutiveErrors = Number(connection.errori_consecutivi || 0) + 1;
    await db.from("crm_external_connections").update({ ultimo_errore: error.message, errori_consecutivi: consecutiveErrors }).eq("id", connection.id);
    if (consecutiveErrors >= 2) await notifyDigitalAdmins(db, connection, "crm_digital_sync_error").catch(() => null);
    throw error;
  }
}

async function syncNow(req, body) {
  const auth = await authorize(req, true); const connection = await connectionById(auth.supabase, body.id);
  if (!connection.abilitata) throw Object.assign(new Error("La connessione deve essere attiva."), { status: 409 });
  const result = await synchronize(auth.supabase, auth.id, connection); await audit(auth.supabase, auth.id, connection, "sync.manual", "success", { status: result.status, count: result.recordsRead }); return result;
}

async function operationalData(db, body = {}) {
  const connectionId = body.id || null;
  const connections = await list(db);
  let runQuery = db.from("crm_sync_runs").select("id,connection_id,sync_type,mode,status,started_at,completed_at,records_read,records_inserted,records_updated,records_failed,duration_ms,error_code,error_message,details,created_at").order("created_at", { ascending: false }).limit(100);
  let auditQuery = db.from("crm_connection_audit").select("id,connection_id,provider_code,operation,outcome,details,created_at").order("created_at", { ascending: false }).limit(100);
  let mappingQuery = db.from("crm_product_mappings").select("id,connection_id,marketplace,external_sku,asin,product_id,codice_mexal,status,match_method,verified_at").order("aggiornato_il", { ascending: false }).limit(100);
  if (connectionId) { runQuery = runQuery.eq("connection_id", connectionId); auditQuery = auditQuery.eq("connection_id", connectionId); mappingQuery = mappingQuery.eq("connection_id", connectionId); }
  const [runs, audits, mappings] = await Promise.all([runQuery, auditQuery, mappingQuery]);
  if (runs.error) throw runs.error; if (audits.error) throw audits.error; if (mappings.error) throw mappings.error;
  return { connections, runs: runs.data || [], audit: audits.data || [], mappings: mappings.data || [], diagnostics: { scheduler: "daily", connectionCount: connections.length, activeCount: connections.filter((row) => row.abilitata).length, failedCount: connections.filter((row) => row.stato === "errore").length } };
}

async function oauthStart(req, body) {
  const auth = await authorize(req, true); const connection = await connectionById(auth.supabase, body.id);
  const result = await startDigitalOAuth(auth.supabase, auth.id, connection);
  await audit(auth.supabase, auth.id, connection, "oauth.started"); return result;
}

async function saveMapping(req, body) {
  const auth = await authorize(req, true); const connection = await connectionById(auth.supabase, body.connectionId);
  const payload = { id: body.mappingId || undefined, connection_id: body.connectionId, marketplace: body.marketplace || null, external_sku: String(body.externalSku || "").trim(), asin: body.asin || null, product_id: body.productId || null, codice_mexal: body.codiceMexal || null, status: body.status || "unmatched", match_method: body.matchMethod || "manual", verified_by: auth.id, verified_at: new Date().toISOString(), aggiornato_il: new Date().toISOString() };
  if (!payload.external_sku) throw Object.assign(new Error("SKU esterno obbligatorio."), { status: 400 });
  const { data, error } = await auth.supabase.from("crm_product_mappings").upsert(payload).select().single(); if (error) throw error;
  await audit(auth.supabase, auth.id, connection, "mapping.updated", "success", { fields: payload });
  if (["probable", "unmatched"].includes(payload.status)) await notifyDigitalAdmins(auth.supabase, connection, "crm_digital_mapping_anomaly", { cooldownHours: 24 }).catch(() => null);
  return { mapping: data };
}

export async function dispatchDigitalSchedule(req) {
  if (!process.env.CRON_SECRET || req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) throw Object.assign(new Error("Cron non autorizzato."), { status: 401 });
  const db = serviceClient(); const now = new Date().toISOString();
  const { data: expired } = await db.from("crm_external_connections").select(SAFE_CONNECTION_FIELDS).eq("abilitata", true).in("provider_code", ["shopify", "meta_ads"]).not("oauth_scade_il", "is", null).lte("oauth_scade_il", now);
  for (const connection of expired || []) { await db.from("crm_external_connections").update({ stato: "oauth_scaduto", abilitata: false, sync_attivo: false }).eq("id", connection.id); await notifyDigitalAdmins(db, connection, "crm_digital_oauth_expired", { cooldownHours: 24 }).catch(() => null); }
  const { data, error } = await db.from("crm_external_connections").select(SAFE_CONNECTION_FIELDS).eq("abilitata", true).eq("sync_attivo", true).eq("sync_frequency", "daily").lte("prossima_run_il", now).limit(10);
  if (error) throw error; const results = [];
  for (const connection of data || []) { try { results.push({ connectionId: connection.id, ...(await synchronize(db, null, connection, "scheduled")) }); } catch (runError) { results.push({ connectionId: connection.id, status: "failed", error: runError.message }); } }
  return { processed: results.length, results };
}

export async function handleDigitalConnectionManager(req, res) {
  const body = req.body || {}; const action = String(body.action || req.query?.action || "list");
  try {
    if (action === "oauth_callback") { const result = await completeDigitalOAuth(serviceClient(), req.query || {}); return res.redirect(302, result.redirectPath); }
    if (action === "dispatch") return res.status(200).json({ success: true, ...(await dispatchDigitalSchedule(req)) });
    if (["list", "operational"].includes(action)) { const auth = await authorize(req); const data = action === "list" ? { registry: DIGITAL_PROVIDER_REGISTRY.map(safeProvider), connections: await list(auth.supabase) } : await operationalData(auth.supabase, body); return res.status(200).json({ success: true, ...data }); }
    if (req.method !== "POST") return res.status(405).json({ success: false, error: "Metodo non consentito." });
    const handlers = { save, revoke_secret: revokeSecret, test: testConnection, activate, deactivate, sync_now: syncNow, save_mapping: saveMapping, oauth_start: oauthStart };
    if (!handlers[action]) throw Object.assign(new Error("Azione Connection Manager non supportata."), { status: 400 });
    return res.status(200).json({ success: true, ...(await handlers[action](req, body)) });
  } catch (error) {
    if (action === "oauth_callback") return res.redirect(302, "/settings/crm-digital?oauth=error");
    const status = Number(error.status || 500); if (status >= 500) console.error("CRM Digital Connection Manager", redact({ message: error.message, code: error.code }));
    return res.status(status >= 400 && status <= 599 ? status : 500).json({ success: false, error: String(error.message || "Operazione non riuscita.").slice(0, 500) });
  }
}
