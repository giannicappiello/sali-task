import https from "node:https";
import { createClient } from "@supabase/supabase-js";
import { completeSyncRun, createSyncRun, failSyncRun } from "../../api/mexal/lib/syncRuns.js";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};
async function mainHandler(req) {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Metodo non consentito" }, 405);
  }
  const startedAt = Date.now();
  let runId = null;
  let centralRunId = null;
  let supabase = null;
  try {
    const token = getBearerToken(req);
    const body = await readBody(req);
    const mode = body.mode === "incremental" ? "incremental" : "full";
    const dryRun = body.dryRun === true;
    const syncPayments = body.syncPayments !== false;
    supabase = createClient(
      requiredEnv("SUPABASE_URL"),
      requiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
      { auth: { persistSession: false, autoRefreshToken: false } }
    );
    const isCron = Boolean(process.env.CRON_SECRET) && token === process.env.CRON_SECRET;
    const user = isCron ? null : await requireAuthenticatedUser(supabase, token);
    if (!isCron) await requireOrdersAdministrator(supabase, user.id);
    const run = await insertOne(supabase, "ordini_sync_runs", {
      sync_type: "commercial_conditions",
      source_system: "MEXAL",
      status: "running",
      requested_by: user?.id || null,
      parameters: { mode, dryRun, syncPayments }
    });
    runId = String(run.id);
    const centralRun = await createSyncRun(supabase, {
      syncType: "commercial_conditions",
      metadata: { mode, dryRun, syncPayments },
    });
    if (centralRun.duplicate) throw new HttpError(409, "È già presente una sincronizzazione condizioni commerciali in corso.");
    centralRunId = centralRun.id;
    const mexal = createMexalClient();
    const matrixStats = { read: 0, written: 0, deactivated: 0, warnings: [] };
    const particularityStats = { read: 0, written: 0, deactivated: 0, warnings: [] };
    const paymentStats = { read: 0, written: 0, deactivated: 0, warnings: [] };
    const [matrixItems, particularityItems] = await Promise.all([
      mexal.getAll("/dati-generali/sconti-listini"),
      mexal.getAll("/dati-generali/particolarita")
    ]);
    matrixStats.read = matrixItems.length;
    particularityStats.read = particularityItems.length;
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const matrixRows = await Promise.all(
      matrixItems.map(async (item) => ({
        cod_cat_cli: integer(item.cod_cat_cli),
        cod_cat_art: integer(item.cod_cat_art),
        sconto: stringValue(item.sconto),
        sconto_esteso: stringValue(item.sconto_esteso),
        source_hash: await sha256(stableStringify(item)),
        dati_mexal: item,
        sync_run_id: runId,
        is_active: true,
        last_seen_at: now
      }))
    );
    const particularityRows = await Promise.all(
      particularityItems.map(async (item) => {
        const ruleKeyPayload = {
          tipo_part: item.tipo_part,
          tp_dato_conto: item.tp_dato_conto,
          codice_conto: item.codice_conto,
          id_cat_conto: item.id_cat_conto,
          id_catsta_conto: item.id_catsta_conto,
          tp_dato_art: item.tp_dato_art,
          cod_articolo: item.cod_articolo,
          id_cat_art: item.id_cat_art,
          cod_grp_merc: item.cod_grp_merc,
          nr_catsta_art: item.nr_catsta_art,
          cod_natura: item.cod_natura,
          data_inizio: item.data_inizio,
          data_fine: item.data_fine,
          id_promozione: item.id_promozione,
          part_1: item.part_1,
          part_2: item.part_2,
          scaglione1: item.scaglione1,
          scaglione_2: item.scaglione_2
        };
        return {
          chiave_regola: await sha256(stableStringify(ruleKeyPayload)),
          tipo_part: enumValue(item.tipo_part, ["P", "S", "V"], "S"),
          tp_dato_conto: enumValue(item.tp_dato_conto, ["C", "N", "S"], "C"),
          codice_conto: stringValue(item.codice_conto),
          id_cat_conto: integer(item.id_cat_conto),
          id_zona_conto: integer(item.id_zona_conto),
          id_catsta_conto: integer(item.id_catsta_conto),
          tp_dato_art: enumValue(item.tp_dato_art, ["A", "T", "M", "E", "U"], "A"),
          cod_articolo: stringValue(item.cod_articolo),
          id_cat_art: integer(item.id_cat_art),
          cod_catsta_art: stringValue(item.cod_catsta_art),
          nr_catsta_art: integer(item.nr_catsta_art),
          cod_natura: stringValue(item.cod_natura),
          cod_grp_merc: stringValue(item.cod_grp_merc),
          data_inizio: parseMexalDate(item.data_inizio),
          data_fine: parseMexalDate(item.data_fine),
          cod_iva: stringValue(item.cod_iva),
          id_valuta: integer(item.id_valuta),
          tp_fino: stringValue(item.tp_fino),
          cod_art_cli: stringValue(item.cod_art_cli),
          descr_art_cli: stringValue(item.descr_art_cli),
          id_promozione: integer(item.id_promozione),
          tp_applica: stringValue(item.tp_applica),
          tp_condizione: stringValue(item.tp_condizione),
          tp_applicazione: stringValue(item.tp_applicazione),
          scaglione1: arrayValue(item.scaglione1),
          part_1: arrayValue(item.part_1),
          tipo_pr_1: arrayValue(item.tipo_pr_1),
          cod_agente_1: arrayValue(item.cod_agente_1),
          cod_cond_1: arrayValue(item.cod_cond_1),
          scaglione_2: arrayValue(item.scaglione_2),
          part_2: arrayValue(item.part_2),
          tipo_pr_2: arrayValue(item.tipo_pr_2),
          cod_agente_2: arrayValue(item.cod_agente_2),
          cod_cond_2: arrayValue(item.cod_cond_2),
          utente_ult_mod: stringValue(item.utente_ult_mod),
          data_ult_mod: stringValue(item.data_ult_mod),
          source_hash: await sha256(stableStringify(item)),
          dati_mexal: item,
          sync_run_id: runId,
          is_active: true,
          last_seen_at: now
        };
      })
    );
    if (!dryRun) {
      matrixStats.written = await upsertInBatches(
        supabase,
        "ordini_sconti_listini",
        matrixRows,
        "cod_cat_cli,cod_cat_art"
      );
      particularityStats.written = await upsertInBatches(
        supabase,
        "ordini_particolarita",
        particularityRows,
        "chiave_regola"
      );
      if (mode === "full") {
        matrixStats.deactivated = await deactivateMissing(
          supabase,
          "ordini_sconti_listini",
          runId
        );
        particularityStats.deactivated = await deactivateMissing(
          supabase,
          "ordini_particolarita",
          runId
        );
      }
    }
    if (syncPayments) {
      const paymentEndpoint = optionalEnv("MEXAL_PAYMENT_DISCOUNT_ENDPOINT");
      if (paymentEndpoint) {
        try {
          const paymentItems = await mexal.getAll(paymentEndpoint);
          paymentStats.read = paymentItems.length;
          const paymentRows = await Promise.all(
            paymentItems.map((item) => ({
              codice_pagamento: firstNonEmpty(
                item.codice_pagamento,
                item.codice,
                item.id,
                item.cod_pagamento
              ),
              descrizione: firstNonEmpty(item.descrizione, item.descr, item.nome),
              sconto: firstNonEmpty(item.sconto, item.sconto_pagamento),
              sconto_esteso: firstNonEmpty(
                item.sconto_esteso,
                item.sconto,
                item.sconto_pagamento
              ),
              data_inizio: parseMexalDate(item.data_inizio),
              data_fine: parseMexalDate(item.data_fine),
              priority: integer(item.priority) || 100,
              origine: "MEXAL",
              source_hash: "",
              dati_mexal: item,
              sync_run_id: runId,
              is_active: true,
              last_seen_at: now
            })).filter((row) => row.codice_pagamento)
          );
          for (const row of paymentRows) {
            row.source_hash = await sha256(stableStringify(row.dati_mexal));
          }
          if (!dryRun) {
            paymentStats.written = await upsertInBatches(
              supabase,
              "ordini_regole_pagamento",
              paymentRows,
              "codice_pagamento"
            );
            if (mode === "full") {
              paymentStats.deactivated = await deactivateMissing(
                supabase,
                "ordini_regole_pagamento",
                runId,
                "origine=eq.MEXAL"
              );
            }
          }
        } catch (error) {
          paymentStats.warnings.push(errorMessage(error));
          await logSyncError(
            supabase,
            runId,
            "payment_rules",
            null,
            error,
            true
          );
        }
      } else {
        paymentStats.warnings.push(
          "MEXAL_PAYMENT_DISCOUNT_ENDPOINT non configurato. Le regole pagamento manuali restano attive."
        );
      }
    }
    await Promise.all([
      writeDetail(supabase, runId, "discount_matrix", matrixStats),
      writeDetail(supabase, runId, "particularities", particularityStats),
      writeDetail(supabase, runId, "payment_rules", paymentStats)
    ]);
    const warnings = [
      ...matrixStats.warnings,
      ...particularityStats.warnings,
      ...paymentStats.warnings
    ];
    const totals = {
      read: matrixStats.read + particularityStats.read + paymentStats.read,
      written: matrixStats.written + particularityStats.written + paymentStats.written,
      deactivated: matrixStats.deactivated + particularityStats.deactivated + paymentStats.deactivated
    };
    const status = warnings.length > 0 ? "completed_with_warnings" : "completed";
    const durationMs = Date.now() - startedAt;
    await supabase.from("ordini_sync_runs").update({
      status,
      completed_at: (/* @__PURE__ */ new Date()).toISOString(),
      duration_ms: durationMs,
      records_read: totals.read,
      records_updated: totals.written,
      records_deactivated: totals.deactivated,
      warning_count: warnings.length,
      summary: {
        matrix: matrixStats,
        particularities: particularityStats,
        paymentRules: paymentStats,
        dryRun
      }
    }).eq("id", runId);
    await completeSyncRun(supabase, centralRunId, { processed: totals.read, updated: totals.written, skipped: totals.deactivated, failed: warnings.length, metadata: { mode, dryRun, syncPayments, warnings } });
    return jsonResponse({
      ok: true,
      runId,
      status,
      durationMs,
      dryRun,
      matrix: matrixStats,
      particularities: particularityStats,
      paymentRules: paymentStats
    });
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    const message = errorMessage(error);
    if (supabase && centralRunId) await failSyncRun(supabase, centralRunId, message);
    if (supabase && runId) {
      await logSyncError(supabase, runId, "commercial_conditions", null, error, false);
      await supabase.from("ordini_sync_runs").update({
        status: "failed",
        completed_at: (/* @__PURE__ */ new Date()).toISOString(),
        duration_ms: durationMs,
        records_failed: 1,
        error_message: message
      }).eq("id", runId);
    }
    return jsonResponse({ ok: false, runId, error: message }, 500);
  }
}
async function requireAuthenticatedUser(supabase, token) {
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) {
    throw new HttpError(401, "Sessione non valida");
  }
  return data.user;
}
async function requireOrdersAdministrator(supabase, userId) {
  const { data: profile, error } = await supabase
    .from("utenti")
    .select(`
      id,
      auth_user_id,
      attivo,
      ruolo_id,
      ruoli(nome, livello)
    `)
    .eq("auth_user_id", userId)
    .maybeSingle();

  if (error) {
    throw new HttpError(
      403,
      `Impossibile verificare il profilo Workspace: ${error.message}`
    );
  }

  if (!profile) {
    throw new HttpError(403, "Profilo Workspace non trovato");
  }

  if (profile.attivo === false) {
    throw new HttpError(403, "Utente Workspace non attivo");
  }

  const roleName = stringValue(profile.ruoli?.nome).toLowerCase();
  const roleLevel = Number(profile.ruoli?.livello || 0);

  const isWorkspaceAdmin =
    [
      "admin",
      "administrator",
      "amministratore",
      "super admin",
      "direzione"
    ].includes(roleName) || roleLevel >= 80;

  if (isWorkspaceAdmin) return;

  throw new HttpError(
    403,
    "Operazione riservata agli amministratori del Workspace"
  );
}
function createMexalClient() {
  const baseUrl = requiredEnv("MEXAL_BASE_URL").replace(/\/+$/, "");
  const username = requiredEnv("MEXAL_USERNAME");
  const password = requiredEnv("MEXAL_PASSWORD");
  const authorization = `Passepartout ${Buffer.from(`${username}:${password}`, "utf8").toString("base64")}`;
  const azienda = requiredEnv("MEXAL_AZIENDA");
  const anno = integer(optionalEnv("MEXAL_ANNO")) || (/* @__PURE__ */ new Date()).getFullYear();
  const magazzino = integer(optionalEnv("MEXAL_MAGAZZINO"));
  const pageSize = Math.min(
    Math.max(integer(optionalEnv("MEXAL_PAGE_SIZE")) || 500, 50),
    1e3
  );
  const maxPages = Math.min(
    Math.max(integer(optionalEnv("MEXAL_MAX_PAGES")) || 100, 1),
    1e3
  );
  const headers = {
    Authorization: authorization,
    "Coordinate-Gestionale": `Azienda=${azienda} Anno=${anno} Magazzino=${magazzino}`,
    Accept: "application/json"
  };
  function requestJson(url) {
    return new Promise((resolve, reject) => {
      const request = https.request(
        {
          protocol: url.protocol,
          hostname: url.hostname,
          port: url.port || 443,
          path: `${url.pathname}${url.search}`,
          method: "GET",
          headers,
          rejectUnauthorized: false,
          timeout: 6e4
        },
        (response) => {
          const chunks = [];
          response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
          response.on("end", () => {
            const raw = Buffer.concat(chunks).toString("utf8");
            const body = parseJsonOrText(raw);
            const status = response.statusCode || 500;
            if (status < 200 || status >= 300) {
              reject(
                new Error(
                  `Mexal ${status} ${url.pathname}: ${typeof body === "string" ? body : JSON.stringify(body)}`
                )
              );
              return;
            }
            resolve(isRecord(body) ? body : { dati: body });
          });
        }
      );
      request.on("timeout", () => {
        request.destroy(new Error("Timeout collegamento Mexal."));
      });
      request.on("error", reject);
      request.end();
    });
  }
  async function getPage(path, page) {
    const url = new URL(`${baseUrl}/webapi/risorse${path}`);
    url.searchParams.set("max", String(pageSize));
    if (page > 1) url.searchParams.set("pagina", String(page));
    let lastError = null;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        return await requestJson(url);
      } catch (error) {
        lastError = error;
        if (attempt < 3) await sleep(750 * attempt);
      }
    }
    throw lastError ?? new Error(`Errore Mexal su ${path}`);
  }
  return {
    async getAll(path) {
      const all = [];
      const seenHashes = /* @__PURE__ */ new Set();
      for (let page = 1; page <= maxPages; page += 1) {
        const body = await getPage(path, page);
        const rows = extractRows(body);
        if (rows.length === 0) break;
        let added = 0;
        for (const row of rows) {
          const hash = stableStringify(row);
          if (!seenHashes.has(hash)) {
            seenHashes.add(hash);
            all.push(row);
            added += 1;
          }
        }
        const hasExplicitPagination = body.pagina !== void 0 || body.page !== void 0 || body.numero_pagina !== void 0 || body.pagine_totali !== void 0 || body.total_pages !== void 0 || body.has_more !== void 0 || body.next !== void 0;
        if (!hasExplicitPagination) break;
        if (rows.length < pageSize || added === 0) break;
        const totalPages = integer(body.pagine_totali ?? body.total_pages);
        if (totalPages > 0 && page >= totalPages) break;
        if (body.has_more === false || body.next === null) break;
      }
      return all;
    }
  };
}
async function upsertInBatches(supabase, table, rows, onConflict) {
  const batchSize = 500;
  let written = 0;
  for (let offset = 0; offset < rows.length; offset += batchSize) {
    const batch = rows.slice(offset, offset + batchSize);
    const { error } = await supabase.from(table).upsert(batch, { onConflict, ignoreDuplicates: false });
    if (error) {
      throw new Error(`${table}: ${error.message}`);
    }
    written += batch.length;
  }
  return written;
}
async function deactivateMissing(supabase, table, runId, extraFilter) {
  let query = supabase.from(table).update({ is_active: false }).eq("is_active", true).neq("sync_run_id", runId);
  if (extraFilter) {
    const [column, expression] = extraFilter.split("=");
    if (column && expression?.startsWith("eq.")) {
      query = query.eq(column, expression.slice(3));
    }
  }
  const { data, error } = await query.select("id");
  if (error) throw new Error(`${table} deactivate: ${error.message}`);
  return data?.length ?? 0;
}
async function writeDetail(supabase, runId, entityType, stats) {
  const status = stats.warnings.length > 0 ? "warning" : "success";
  const { error } = await supabase.from("ordini_sync_run_details").insert({
    run_id: runId,
    entity_type: entityType,
    phase: "sync",
    status,
    records_read: stats.read,
    records_written: stats.written,
    records_deactivated: stats.deactivated,
    message: stats.warnings.join(" | ") || null,
    metadata: { warnings: stats.warnings }
  });
  if (error) {
    console.error("Impossibile scrivere sync detail:", error.message);
  }
}
async function logSyncError(supabase, runId, entityType, sourceKey, error, retryable) {
  const { error: insertError } = await supabase.from("ordini_sync_errors").insert({
    run_id: runId,
    entity_type: entityType,
    source_key: sourceKey,
    error_message: errorMessage(error),
    retryable
  });
  if (insertError) {
    console.error("Impossibile registrare sync error:", insertError.message);
  }
}
async function insertOne(supabase, table, values) {
  const { data, error } = await supabase.from(table).insert(values).select("*").single();
  if (error) throw new Error(`${table}: ${error.message}`);
  return data;
}
function extractRows(body) {
  const candidates = [
    body.dati,
    body.data,
    body.risultati,
    body.results,
    body.items
  ];
  for (const value of candidates) {
    if (Array.isArray(value)) {
      return value.filter(isRecord);
    }
  }
  return [];
}
function parseMexalDate(value) {
  const raw = stringValue(value).replace(/\D/g, "").slice(0, 8);
  if (!raw || raw === "00000000") return null;
  if (!/^\d{8}$/.test(raw)) return null;
  const year = raw.slice(0, 4);
  const month = raw.slice(4, 6);
  const day = raw.slice(6, 8);
  const result = `${year}-${month}-${day}`;
  const date = /* @__PURE__ */ new Date(`${result}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : result;
}
function getBearerToken(req) {
  const header = req.headers.get("Authorization") ?? "";
  if (!header.startsWith("Bearer ")) {
    throw new HttpError(401, "Sessione mancante");
  }
  return header.slice(7);
}
async function readBody(req) {
  const text = await req.text();
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, "Body JSON non valido");
  }
}
function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Variabile ${name} mancante`);
  return value;
}
function optionalEnv(name) {
  return process.env[name]?.trim() ?? "";
}
function stringValue(value) {
  return String(value ?? "").trim();
}
function firstNonEmpty(...values) {
  for (const value of values) {
    const result = stringValue(value);
    if (result) return result;
  }
  return "";
}
function integer(value) {
  const normalized = stringValue(value).replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : 0;
}
function arrayValue(value) {
  return Array.isArray(value) ? value : [];
}
function enumValue(value, allowed, fallback) {
  const normalized = stringValue(value).toUpperCase();
  return allowed.includes(normalized) ? normalized : fallback;
}
function parseJsonOrText(raw) {
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}
function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
async function sha256(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8"
    }
  });
}
class HttpError extends Error {
  status;
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
async function handler(req, res) {
  try {
    const protocol = String(req.headers?.["x-forwarded-proto"] || "https").split(",")[0].trim();
    const host = req.headers?.host || "localhost";
    const url = `${protocol}://${host}${req.url || "/api/mexal/sync-commercial-conditions"}`;
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers || {})) {
      if (Array.isArray(value)) headers.set(key, value.join(", "));
      else if (value !== void 0) headers.set(key, String(value));
    }
    let body;
    if (!["GET", "HEAD"].includes(String(req.method || "GET").toUpperCase())) {
      if (typeof req.body === "string") body = req.body;
      else if (req.body !== void 0 && req.body !== null) body = JSON.stringify(req.body);
      else body = "";
    }
    const webRequest = new Request(url, {
      method: req.method || "POST",
      headers,
      body
    });
    const response = await mainHandler(webRequest);
    const responseBody = await response.text();
    response.headers.forEach((value, key) => res.setHeader(key, value));
    res.status(response.status).send(responseBody);
  } catch (error) {
    console.error("mexal commercial sync adapter:", error);
    res.status(500).json({ ok: false, error: errorMessage(error) });
  }
}
export {
  handler as default
};
