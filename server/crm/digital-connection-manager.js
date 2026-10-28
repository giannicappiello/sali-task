import { synchronizeShipmentDates } from './amazon-shipments.js';
/* global process */
import crypto from "node:crypto";
import { persistProductMapping } from "./product-mapping.js";
import { fetchCustomerProfiles } from "./customer-profiles.js";
import { createClient } from "@supabase/supabase-js";
import { DIGITAL_PROVIDER_REGISTRY, providerDefinition, requiredSecretNames, validateProviderConfiguration } from "../../shared/digitalProviderRegistry.js";
import { requireAdmin, requirePermission, requireScreenManagement } from "../mexal/lib/auth.js";
import { decryptSecret, encryptSecret, maskSecret, redact } from "./digital-security.js";
import { makeSyncIdempotencyKey } from "./digital-connectors.js";
import { testProviderConnection } from "./digital-provider-adapters.js";
import { completeDigitalOAuth, startDigitalOAuth } from "./digital-oauth.js";
import { notifyDigitalAdmins } from "./digital-notifications.js";
import { COMMERCE_PROVIDERS, fetchCommercePage } from "./commerce-import.js";
import { authorizedDigitalScheduler, runDigitalDailyJobs } from "./digital-daily-scheduler.js";
import { loadDigitalOrderDetail } from './digital-order-detail.js';
import { synchronizeAmazonCox } from './amazon-cox.js';
import { buildMexalClient } from '../mexal/sync-products.js';
import { probeAmazonBuyer } from './amazon-buyer.js';
import { synchronizeAmazonRefunds } from './amazon-refunds.js';
import { financialTransactions,fbaReturnReport,refundFinancialEvents } from './amazon-returns-source.js';

const SAFE_CONNECTION_FIELDS = "id,tipo,provider_code,provider,nome,category,auth_type,stato,endpoint_url,site_url,external_account_id,marketplace_ids,configurazione,secret_references,credenziali_stato,abilitata,sync_attivo,sync_frequency,is_default,ultimo_test_il,ultimo_test_stato,ultimo_test_messaggio,errori_consecutivi,ultimo_sync_il,prossima_run_il,ultimo_errore,oauth_scade_il,webhook_path,webhook_stato,ultimo_webhook_il,disabilitata_il,aggiornata_il,import_state,amazon_cox_state,amazon_cox_from,amazon_shipment_state,amazon_shipments_covered_at,amazon_refunds_from,amazon_refund_state,responsabile_id,reparto_id";

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
  if (COMMERCE_PROVIDERS.includes(connection.provider_code)) return synchronizeCommerce(db, actorId, connection, mode);
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

async function refreshCustomerProfiles(req, body) {
  const auth = await authorize(req);
  const connection = await connectionById(auth.supabase, body.id);
  if (!connection.abilitata) throw Object.assign(new Error('Connessione disattivata.'), { status: 400 });
  const result = await fetchCustomerProfiles(connection, await decryptedSecrets(auth.supabase, connection.id), body.cursor || {});
  for (const row of result.rows) {
    const { error } = await auth.supabase.rpc('crm_enrich_customer_profile_service', { target_connection_id: connection.id, profile: row });
    if (error) throw error;
  }
  return { recordsRead: result.rows.length, next: result.next };
}

export async function synchronizeCommerce(db, actorId, connection, mode, shipmentDatesOnly = false, {
  readConnection=connectionById, readSecrets=decryptedSecrets, fetchPage=fetchCommercePage,
  shipmentSync=synchronizeShipmentDates, coxSync=synchronizeAmazonCox, refundSync=synchronizeAmazonRefunds, refundsOnly=false,
}={}) {
  const { data: runId, error: lockError } = await db.rpc('crm_claim_commerce_import_service', {
    target_connection_id: connection.id, target_triggered_by: actorId || null,
  });
  if (lockError) throw Object.assign(lockError, { status: lockError.code === '55P03' ? 409 : 500 });
  const finish = async (status, counts, details, error = null) => {
    const result = await db.rpc('crm_complete_sync_run_service', { target_run_id: runId, target_status: status,
      target_counts: counts, target_error_code: error?.code || null, target_error_message: error?.message || null, target_details: details });
    if (result.error) throw result.error;
  };
  try {
    // Read the cursor after acquiring the lock: another request may have just finished a page.
    const fresh = await readConnection(db, connection.id);
    const emitRefunds=async()=>{
      let refunds;
      try{refunds=await refundSync({db,connection:fresh,secrets:await readSecrets(db,fresh.id),clientForYear:year=>buildMexalClient({year,warehouse:4})});}
      catch(error){
        const current=await readConnection(db,fresh.id),message=String(error.message).slice(0,500);
        const saved=await db.from('crm_external_connections').update({amazon_refund_state:{...current.amazon_refund_state,active:false,lastError:message,retryAt:new Date(Date.now()+900000).toISOString()}}).eq('id',fresh.id);
        if(saved.error)throw saved.error;
        refunds={hasMore:false,failed:1,warning:message};
      }
      await finish(refunds.hasMore?'partial':'completed',{read:refunds.recordsRead || 0,updated:(refunds.emitted || 0)+(refunds.updated || 0),failed:refunds.failed || 0},{source:mode,resource:'amazon_refunds',hasMore:refunds.hasMore,refunds});
      return {...refunds,refunds,runId,status:refunds.hasMore?'partial':'completed',resource:'amazon_refunds',counts:fresh.import_state?.counts || {}};
    };
    if(fresh.provider_code==='amazon_sp_api' && (refundsOnly || fresh.amazon_refund_state?.active)){
      if(!fresh.amazon_refunds_from)throw new Error('Configurare la data iniziale dei rimborsi Amazon.');
      return await emitRefunds();
    }
    let shipmentWarning=fresh.amazon_shipment_state?.lastError || null;
    if(fresh.provider_code==='amazon_sp_api' && (shipmentDatesOnly || (fresh.amazon_cox_state?.active && fresh.amazon_cox_state.phase==='shipments'))) {
      let shipping;
      try { shipping=await shipmentSync({db,connection:fresh,secrets:await readSecrets(db,fresh.id),...(shipmentDatesOnly?{coverageThrough:new Date(Date.now()-180000).toISOString()}:{})}); }
      catch(error) {
        if(shipmentDatesOnly) throw error;
        shipmentWarning=String(error.message).slice(0,500);
        const saved=await db.from('crm_external_connections').update({amazon_shipment_state:{...fresh.amazon_shipment_state,lastError:shipmentWarning,retryAt:new Date(Date.now()+900000).toISOString()}}).eq('id',fresh.id);
        if(saved.error) throw saved.error;
        shipping={hasMore:false,warning:shipmentWarning};
      }
      shipmentWarning=shipping.warning || null;
      if(shipping.hasMore || shipmentDatesOnly) {
        const status=shipping.hasMore?'partial':'completed';
        await finish(status,{read:shipping.recordsRead||0,updated:shipping.recordsRead||0},{source:mode,resource:'amazon_shipments',hasMore:shipping.hasMore,reports:shipping.reports,shipmentWarning});
        return {...shipping,runId,status,shipmentWarning};
      }
      fresh.amazon_cox_state={active:true,phase:'reconcile'};
      const saved=await db.from('crm_external_connections').update({amazon_cox_state:fresh.amazon_cox_state}).eq('id',fresh.id);
      if(saved.error) throw saved.error;
    }
    const emitCox = async () => {
      const cox = await coxSync({ db, connection: fresh,
        clientForYear: year => buildMexalClient({ year, warehouse: 4 }) });
      const hasMore=cox.hasMore || Boolean(fresh.amazon_refunds_from);
      if(!cox.hasMore && fresh.amazon_refunds_from){
        const saved=await db.from('crm_external_connections').update({amazon_refund_state:{...fresh.amazon_refund_state,active:true}}).eq('id',fresh.id);
        if(saved.error)throw saved.error;
      }
      await finish(hasMore ? 'partial' : 'completed', { read: 0, updated: cox.emitted, failed: cox.failed },
        { source: mode, resource: 'amazon_cox', hasMore, cox, shipmentWarning });
      return { runId, status: hasMore ? 'partial' : 'completed', hasMore,
        recordsRead: 0, resource: 'amazon_cox', counts: fresh.import_state?.counts || {}, cox, shipmentWarning };
    };
    if (fresh.provider_code === 'amazon_sp_api' && fresh.amazon_cox_state?.active) return await emitCox();
    const page = await fetchPage(fresh, await readSecrets(db, connection.id), fresh.import_state,{
      loadShipmentDates:async ids=>{if(!ids.length)return new Map();const {data,error}=await db.from('crm_amazon_shipment_dates').select('external_id,shipped_at').eq('connection_id',fresh.id).in('external_id',ids);if(error)throw error;return new Map(data.map(row=>[row.external_id,row.shipped_at]));},
      loadTaxClassifications:async ids=>{if(!ids.length)return new Map();const {data,error}=await db.from('crm_external_orders').select('external_id,raw_summary').eq('connection_id',fresh.id).in('external_id',ids);if(error)throw error;return new Map(data.filter(row=>row.raw_summary?.tax_collection?.source==='user_confirmed').map(row=>[row.external_id,row.raw_summary.tax_collection]));},
    });
    const { error } = await db.rpc('crm_import_commerce_page_service', { target_connection_id: connection.id, target_run_id: runId,
      expected_state: fresh.import_state, resource_kind: page.kind, page_rows: page.rows, next_state: page.next });
    if (error) throw error;
    const recoveryOrders=mode==='recovery' && page.kind==='orders' ? {orderIds:page.rows.map(row=>row.external_id)} : {};
    if (fresh.provider_code === 'amazon_sp_api' && !page.hasMore) {
      const saved = await db.from('crm_external_connections').update({ amazon_cox_state: { active: true, phase:'shipments' } }).eq('id', fresh.id);
      if (saved.error) throw saved.error;
      // Start with the next bounded request; all provider pages have been committed.
      await finish('partial', { read: page.rows.length, updated: page.rows.length, failed: 0 },
        { source: mode, resource: page.kind, counts: page.next.counts, hasMore: true });
      return { runId, status: 'partial', hasMore: true, recordsRead: page.rows.length, resource: page.kind, counts: page.next.counts, ...recoveryOrders };
    }
    await finish(page.hasMore ? 'partial' : 'completed', { read: page.rows.length, updated: page.rows.length, failed: 0 }, { source: mode, resource: page.kind, counts: page.next.counts, hasMore: page.hasMore });
    return { runId, status: page.hasMore ? 'partial' : 'completed', hasMore: page.hasMore, recordsRead: page.rows.length, resource: page.kind, counts: page.next.counts, ...recoveryOrders };
  } catch (error) {
    if (error.code === 'provider_429') {
      const state = (await connectionById(db, connection.id)).import_state;
      await finish('partial', { failed: 0 }, { source: mode, rate_limited: true, cursor_preserved: true });
      return { runId, status: 'partial', hasMore: true, retryAfterMs: connection.provider_code === 'amazon_sp_api' ? 180000 : 60000,
        recordsRead: 0, counts: state.counts || { customers: 0, products: 0, orders: 0 } };
    }
    await finish('failed', { failed: 1 }, { source: mode, cursor_preserved: true }, error);
    throw error;
  }
}

async function syncAmazonShipmentDates(req,body) {
  const auth=await authorize(req,true), connection=await connectionById(auth.supabase,body.id);
  if(!connection.abilitata || connection.provider_code !== 'amazon_sp_api') throw Object.assign(new Error('Connessione Amazon attiva richiesta.'),{status:409});
  return synchronizeCommerce(auth.supabase,auth.id,connection,'manual_dates',true);
}

async function syncAmazonRefunds(req,body){
  const auth=await authorize(req,true),connection=await connectionById(auth.supabase,body.id);
  if(!connection.abilitata || connection.provider_code!=='amazon_sp_api')throw Object.assign(new Error('Connessione Amazon attiva richiesta.'),{status:409});
  return synchronizeCommerce(auth.supabase,auth.id,connection,'manual_refunds',false,{refundsOnly:true});
}

async function syncNow(req, body) {
  const auth = await authorize(req, true); const connection = await connectionById(auth.supabase, body.id);
  if (!connection.abilitata) throw Object.assign(new Error("La connessione deve essere attiva."), { status: 409 });
  const result = await synchronize(auth.supabase, auth.id, connection); await audit(auth.supabase, auth.id, connection, "sync.manual", "success", { status: result.status, count: result.recordsRead }); return result;
}

async function operationalData(db, body = {}) {
  const connectionId = body.id || null;
  const connections = await list(db);
  let runQuery = db.from("crm_sync_runs").select("id,connection_id,sync_type,mode,status,started_at,completed_at,records_read,records_inserted,records_updated,records_failed,duration_ms,error_code,error_message,details,created_at").or("sync_type.eq.daily_full,details->>source.is.null,details->>source.neq.scheduled").order("created_at", { ascending: false }).limit(100);
  let auditQuery = db.from("crm_connection_audit").select("id,connection_id,provider_code,operation,outcome,details,created_at").order("created_at", { ascending: false }).limit(100);
  let mappingQuery = db.from("crm_product_mappings").select("id,connection_id,marketplace,external_sku,asin,product_id,codice_mexal,status,match_method,verified_at").order("aggiornato_il", { ascending: false }).limit(100);
  if (connectionId) { runQuery = runQuery.eq("connection_id", connectionId); auditQuery = auditQuery.eq("connection_id", connectionId); mappingQuery = mappingQuery.eq("connection_id", connectionId); }
  const [runs, audits, mappings] = await Promise.all([runQuery, auditQuery, mappingQuery]);
  if (runs.error) throw runs.error; if (audits.error) throw audits.error; if (mappings.error) throw mappings.error;
  return { connections, runs: runs.data || [], audit: audits.data || [], mappings: mappings.data || [], diagnostics: { scheduler: "Ogni giorno alle 23:00 (Europe/Rome)", automaticCount: connections.filter(row => row.abilitata && row.sync_attivo).length, connectionCount: connections.length, activeCount: connections.filter((row) => row.abilitata).length, failedCount: connections.filter((row) => row.stato === "errore").length } };
}

async function oauthStart(req, body) {
  const auth = await authorize(req, true); const connection = await connectionById(auth.supabase, body.id);
  const result = await startDigitalOAuth(auth.supabase, auth.id, connection);
  await audit(auth.supabase, auth.id, connection, "oauth.started"); return result;
}

async function saveMapping(req, body) {
  const auth = await authorize(req, true); const connection = await connectionById(auth.supabase, body.connectionId);
  const data = await persistProductMapping(auth.supabase,connection,body,auth.id);
  await audit(auth.supabase, auth.id, connection, "mapping.updated", "success", { fields: data });
  if (["probable", "unmatched"].includes(data.status)) await notifyDigitalAdmins(auth.supabase, connection, "crm_digital_mapping_anomaly", { cooldownHours: 24 }).catch(() => null);
  return { mapping: data };
}

export async function dispatchDigitalSchedule(req) {
  if (!authorizedDigitalScheduler(req, process.env.SUPABASE_SERVICE_ROLE_KEY, process.env.CRON_SECRET)) throw Object.assign(new Error("Cron non autorizzato."), { status: 401 });
  const db = serviceClient();
  return runDigitalDailyJobs({ db, connectionById, synchronize: async (...args) => {
    if (!COMMERCE_PROVIDERS.includes(args[2].provider_code)) throw new Error('Importazione completa non disponibile per questo provider.');
    return synchronize(...args);
  } });
}

export async function handleDigitalConnectionManager(req, res) {
  const body = req.body || {}; const action = String(body.action || req.query?.action || "list");
  try {
    if(action==='amazon_returns_probe') {
      res.setHeader('Cache-Control','private, no-store');
      if(req.method!=='POST')return res.status(405).json({success:false,error:'Metodo non consentito.'});
      if(!authorizedDigitalScheduler(req,required('SUPABASE_SERVICE_ROLE_KEY'),process.env.CRON_SECRET))throw Object.assign(new Error('Verifica resi riservata al servizio.'),{status:401});
      const db=serviceClient(),connection=await connectionById(db,body.id);
      if(connection.provider_code!=='amazon_sp_api' || !connection.abilitata)throw new Error('Connessione Amazon attiva richiesta.');
      const secrets=await decryptedSecrets(db,connection.id);
      const from=connection.amazon_cox_from+'T00:00:00Z',to=new Date(Date.now()-180000).toISOString();
      const result=body.report?await fbaReturnReport(connection,secrets,{from,to,reportId:body.reportId}):await (body.transactions?financialTransactions:refundFinancialEvents)(connection,secrets,{orderId:body.orderId,from,to,nextToken:body.nextToken});
      return res.status(200).json({success:true,...result});
    }
    if(['recover_amazon_import','recover_amazon_refunds'].includes(action)) {
      res.setHeader('Cache-Control','private, no-store');
      if(req.method!=='POST') return res.status(405).json({success:false,error:'Metodo non consentito.'});
      if(!authorizedDigitalScheduler(req,required('SUPABASE_SERVICE_ROLE_KEY'),process.env.CRON_SECRET)) throw Object.assign(new Error('Recupero riservato al servizio.'),{status:401});
      const db=serviceClient(), connection=await connectionById(db,body.id);
      if(connection.provider_code!=='amazon_sp_api' || !connection.abilitata) throw Object.assign(new Error('Connessione Amazon attiva richiesta.'),{status:409});
      return res.status(200).json({success:true,...await synchronizeCommerce(db,null,connection,'recovery',false,{refundsOnly:action==='recover_amazon_refunds'})});
    }
    if (action === 'amazon_buyer_probe') {
      res.setHeader('Cache-Control','private, no-store');
      if (req.method !== 'POST') return res.status(405).json({ success:false,error:'Metodo non consentito.' });
      const db = serviceClient();
      const result = await probeAmazonBuyer({
        authorize: async () => {
          if (!authorizedDigitalScheduler(req,required('SUPABASE_SERVICE_ROLE_KEY'),process.env.CRON_SECRET)) throw Object.assign(new Error('Verifica riservata al servizio.'),{status:401});
        },
        loadOrder: async () => {
          const { data,error } = await db.from('crm_external_orders')
            .select('connection_id,external_id,crm_external_connections!inner(provider_code,abilitata)')
            .eq('crm_external_connections.provider_code','amazon_sp_api').eq('crm_external_connections.abilitata',true)
            .ilike('stato','shipped').order('ordered_at',{ascending:false}).limit(1).maybeSingle();
          if (error) throw error; return data;
        },
        connection:id => connectionById(db,id), secrets:id => decryptedSecrets(db,id),
      });
      return res.status(200).json({ success:true,...result });
    }
    if (action === 'order_detail') {
      res.setHeader('Cache-Control', 'private, no-store');
      if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Metodo non consentito.' });
      if (!/^[a-f0-9-]{36}$/i.test(String(body.orderId || ''))) throw Object.assign(new Error('Ordine non valido.'), { status: 400 });
      const authorization = String(req.headers.authorization || '');
      if (!authorization.startsWith('Bearer ')) throw Object.assign(new Error('Sessione mancante.'), { status: 401 });
      // Authorization is the user's JWT: PostgREST applies the same RLS as the CRM.
      const reader = createClient(required('SUPABASE_URL'), required('SUPABASE_SERVICE_ROLE_KEY'), {
        global: { headers: { Authorization: authorization } }, auth: { persistSession: false, autoRefreshToken: false },
      });
      const db = serviceClient();
      const detail = await loadDigitalOrderDetail(body.orderId, {
        visibleOrder: async (id) => {
          const { data, error } = await reader.from('crm_external_orders').select('id,connection_id,external_id,marketplace,stato,ordered_at,currency,net_revenue,gross_revenue,discounts,refunds,cox_status,cox_reference,cox_error,raw_summary,crm_accounts(nome)').eq('id', id).maybeSingle();
          if (error) throw error; return data;
        },
        connection: (id) => connectionById(db, id),
        authorizeScreen: (screen) => requireScreenManagement(req, db, screen, { readOnly: true }),
        secrets: (id) => decryptedSecrets(db, id),
        saveMexalReference: async (order, reference) => {
          let update = db.from('crm_external_orders').update({ raw_summary: { ...(order.raw_summary || {}), mexal_oc: reference } }).eq('id', order.id).eq('connection_id', order.connection_id);
          update = order.raw_summary == null ? update.is('raw_summary', null) : update.eq('raw_summary', JSON.stringify(order.raw_summary));
          const { error } = await update;
          if (error) throw error;
        },
        cachedLines: async (id) => {
          const rows = [];
          for (let from = 0; ; from += 200) {
            const { data, error } = await reader.from('crm_external_order_lines').select('id,external_line_id,external_sku,asin,quantity,unit_price,line_revenue,discount,metadati,prodotti(nome)').eq('order_id', id).order('external_line_id').range(from, from + 199);
            if (error) throw error; rows.push(...(data || [])); if (data.length < 200) break;
          }
          return rows.map((l) => ({ id: l.id, name: l.metadati?.name || l.prodotti?.nome || l.external_sku || l.asin || 'Prodotto non identificato', sku: l.external_sku, asin: l.asin, quantity: l.quantity, unitPrice: l.unit_price, amount: l.line_revenue, discount: l.discount }));
        },
      });
      return res.status(200).json({ success: true, ...detail });
    }
    if (action === "oauth_callback") { const result = await completeDigitalOAuth(serviceClient(), req.query || {}); return res.redirect(302, result.redirectPath); }
    if (action === "dispatch") return res.status(200).json({ success: true, ...(await dispatchDigitalSchedule(req)) });
    if (["list", "operational"].includes(action)) { const auth = await authorize(req); const data = action === "list" ? { registry: DIGITAL_PROVIDER_REGISTRY.map(safeProvider), connections: await list(auth.supabase) } : await operationalData(auth.supabase, body); return res.status(200).json({ success: true, ...data }); }
    if (req.method !== "POST") return res.status(405).json({ success: false, error: "Metodo non consentito." });
    const handlers = { refresh_customer_profiles: refreshCustomerProfiles, save, revoke_secret: revokeSecret, test: testConnection, activate, deactivate, sync_now: syncNow, sync_amazon_shipment_dates: syncAmazonShipmentDates, sync_amazon_refunds:syncAmazonRefunds, save_mapping: saveMapping, oauth_start: oauthStart };
    if (!handlers[action]) throw Object.assign(new Error("Azione Connection Manager non supportata."), { status: 400 });
    return res.status(200).json({ success: true, ...(await handlers[action](req, body)) });
  } catch (error) {
    if (action === "oauth_callback") return res.redirect(302, "/settings/crm-digital?oauth=error");
    const status = Number(error.status || 500); if (status >= 500) console.error("CRM Digital Connection Manager", redact({ message: error.message, code: error.code }));
    return res.status(status >= 400 && status <= 599 ? status : 500).json({ success: false, error: String(error.message || "Operazione non riuscita.").slice(0, 500),...(action==='amazon_returns_probe' && error.providerRequestId?{providerRequestId:error.providerRequestId}:{}) });
  }
}
