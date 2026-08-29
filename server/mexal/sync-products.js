import https from "node:https";
import { createClient } from "@supabase/supabase-js";
import { checkpointSyncRunProgress, completeSyncRun, createSyncRun as createCentralSyncRun, failSyncRun, failSyncRunUnlessClosed, findRunningSync, getSyncRun as getCentralSyncRun, isSyncRunClosedError } from "./lib/syncRuns.js";
import { shouldReplayStockCheckpoint, stockBatchCheckpoint, stockRunState, stockUpdateDiagnostics } from "./lib/stockRunState.js";
import { withTransientMexalRetry } from "./lib/transientRetry.js";
import { authoritativeArticleUnit } from "./unit-of-measure.js";

const STORAGE_BUCKET = "prodotti-mexal";
export const PRODUCT_UI_PREFIXES = ["IT", "MKT"];
export const STOCK_WAREHOUSE = 5;
export const TARGETED_SYNC_PREFIXES = ["PB"];
const DEFAULT_BATCH_SIZE = 8;
const MAX_BATCH_SIZE = 12;

function requireEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Variabile Vercel mancante: ${name}`);
  return value;
}

function normalizeCode(value) {
  return String(value || "").trim().toUpperCase();
}

export function normalizeTargetedArticlePrefix(value) {
  const prefix = normalizeCode(value);
  if (!prefix) return null;
  if (!TARGETED_SYNC_PREFIXES.includes(prefix)) {
    throw Object.assign(
      new Error("Prefisso sincronizzazione articoli non consentito."),
      { status: 400 },
    );
  }
  return prefix;
}

export function filterArticlesByPrefix(articles, value) {
  const prefix = normalizeTargetedArticlePrefix(value);
  if (!prefix) return articles;
  const filtered = articles.filter((article) =>
    getArticleCode(article).startsWith(prefix)
  );
  filtered.diagnostics = {
    ...(articles.diagnostics || {}),
    article_prefix: prefix,
    selected_by_prefix: filtered.length,
  };
  return filtered;
}

export function getArticleCode(article) {
  if (typeof article === "string" || typeof article === "number") {
    return normalizeCode(article);
  }

  const directCode = normalizeCode(
    article?.codice ||
      article?.cod_articolo ||
      article?.codice_articolo ||
      article?.cod_art ||
      article?.codice_art ||
      article?.articolo ||
      article?.id_articolo ||
      article?.codiceArticolo ||
      ""
  );

  return directCode;
}

function numberValue(value) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function nullableNumber(value) {
  if (value === null || value === undefined || String(value).trim() === "") {
    return null;
  }

  const parsed = Number(String(value).trim().replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function nullableInteger(value) {
  const parsed = nullableNumber(value);
  return parsed !== null && Number.isInteger(parsed) ? parsed : null;
}

function nullableText(...values) {
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (text) return text;
  }

  return null;
}

// Mexal returns this field in the detail endpoint as a decimal value using
// Italian formatting (e.g. "22,0"). Keep its original representation for the
// document payload and derive the numeric rate only once, at the boundary.
export function getMexalVat(article = {}) {
  const code = nullableText(article.alq_iva);
  return { code, rate: nullableNumber(code) };
}

// Contratto reale gia usato da ProgreMES: Mexal espone il costo ultimo come
// costo_ult e, in alcune versioni, tramite l'alias cos_ult.
export function getLastCost(article = {}) {
  return Math.max(0, nullableNumber(article.costo_ult ?? article.cos_ult) ?? 0);
}

function catalogCollectionPath(value) {
  const path = String(value || "").trim().replace(/^\^/, "").replace(/\$$/, "").replace(/\{0,1\}/g, "")
    .replace(/\/?\((?:\?:)?[^)]*\)\??$/, "").replace(/\/?\{(?:id|codice|identifier)[^}]*\}$/i, "");
  return /^\/[A-Za-z0-9_./-]+$/.test(path) ? path : null;
}

/**
 * Mexal is authoritative for the list of warehouses. The importer only accepts
 * a GET collection path published by the live /help catalogue and never guesses
 * a resource name or a numeric warehouse range.
 */
export function discoverWarehouseCollection(help) {
  const candidates = new Set();
  const visit = (value) => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) return value.forEach(visit);
    const descriptor = Object.entries(value).flatMap(([key, item]) => [key, typeof item === "string" ? item : ""]).join(" ");
    const methods = Object.entries(value)
      .filter(([key]) => /^(method|http_method|methods|verbi|verb)$/i.test(key))
      .flatMap(([, item]) => Array.isArray(item) ? item : [item])
      .map((item) => String(item).toUpperCase());
    if (/magazzin/i.test(descriptor) && (!methods.length || methods.includes("GET"))) {
      for (const [key, item] of Object.entries(value)) {
        if (!/^(regexp|resource|risorsa|endpoint|url|path|percorso)$/i.test(key)) continue;
        const path = catalogCollectionPath(item);
        if (path && /magazzin/i.test(path)) candidates.add(path);
      }
    }
    Object.values(value).forEach(visit);
  };
  visit(help);
  const exactCollections = [...candidates].filter((path) => /\/magazzini$/i.test(path));
  if (exactCollections.length !== 1) {
    throw new Error("Catalogo Mexal: risorsa GET univoca dei magazzini non disponibile.");
  }
  return exactCollections[0];
}

export function extractWarehouseRows(payload) {
  const candidates = [payload, payload?.dati, payload?.magazzini, payload?.records, payload?.items,
    payload?.data, payload?.data?.magazzini, payload?.data?.dati, payload?.risposta?.magazzini, payload?.risposta?.dati];
  return candidates.find(Array.isArray) || [];
}

export function normalizeMexalWarehouse(row = {}) {
  const warehouseNumber = nullableInteger(row.id_magazzino ?? row.numero_magazzino ?? row.cod_magazzino ?? row.id_mag ?? row.magazzino ?? row.id ?? row.codice);
  if (!warehouseNumber || warehouseNumber <= 0) return null;
  return {
    number: warehouseNumber,
    name: nullableText(row.descrizione, row.nome, row.des_magazzino, row.descrizione_magazzino),
  };
}

export async function loadMexalWarehouses(mexal) {
  const help = await mexal.getJson("/help");
  const endpoint = discoverWarehouseCollection(help);
  const payload = await mexal.getJson(endpoint);
  const byNumber = new Map();
  for (const row of extractWarehouseRows(payload)) {
    const warehouse = normalizeMexalWarehouse(row);
    if (warehouse) byNumber.set(warehouse.number, warehouse);
  }
  if (!byNumber.size) throw new Error("Mexal non ha restituito alcun magazzino certificabile.");
  return [...byNumber.values()].sort((left, right) => left.number - right.number);
}

function round4(value) {
  return Math.round((value + Number.EPSILON) * 10000) / 10000;
}

function requestMexal({ url, headers, binary = false, method = "GET", body }) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);

    const request = https.request(
      {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port || 443,
        path: `${parsed.pathname}${parsed.search}`,
        method,
        headers: body ? { ...headers, "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) } : headers,
        rejectUnauthorized: false,
        timeout: 45000,
      },
      (response) => {
        const chunks = [];

        response.on("data", (chunk) => chunks.push(chunk));

        response.on("end", () => {
          const buffer = Buffer.concat(chunks);

          resolve({
            status: response.statusCode || 500,
            headers: response.headers,
            body: binary ? buffer : buffer.toString("utf8"),
          });
        });
      }
    );

    request.on("timeout", () => {
      request.destroy(new Error("Timeout collegamento Mexal."));
    });

    request.on("error", reject);
    if (body) request.write(body);
    request.end();
  });
}

function parseJsonResponse(response, label) {
  let parsed;

  try {
    parsed = JSON.parse(response.body || "{}");
  } catch {
    throw new Error(`${label}: risposta JSON non valida.`);
  }

  if (response.status < 200 || response.status >= 300) {
    const error = new Error(
      parsed?.error?.["response-detail"] ||
        parsed?.error?.["response-message"] ||
        `${label}: HTTP ${response.status}`
    );
    error.status = response.status;
    error.mexalResponse = response;
    throw error;
  }

  return parsed;
}

export function buildMexalClient({ request = requestMexal, warehouse, retryOptions } = {}) {
  const baseUrl = requireEnv("MEXAL_BASE_URL").replace(/\/+$/, "");
  const username = requireEnv("MEXAL_USERNAME");
  const password = requireEnv("MEXAL_PASSWORD");
  const azienda = requireEnv("MEXAL_AZIENDA");
  const anno = requireEnv("MEXAL_ANNO");
  const configuredWarehouse = requireEnv("MEXAL_MAGAZZINO");
  // An explicit null omits Magazzino from Coordinate-Gestionale, so Mexal
  // returns progressives for the complete warehouse scope.
  const magazzino = warehouse === undefined ? configuredWarehouse : warehouse;

  const credential = Buffer.from(
    `${username}:${password}`,
    "utf8"
  ).toString("base64");

  const headers = {
    Authorization: `Passepartout ${credential}`,
    "Coordinate-Gestionale":
      `Azienda=${azienda} Anno=${anno}${magazzino === null ? "" : ` Magazzino=${magazzino}`}`,
    Accept: "application/json",
  };

  return {
    baseUrl,
    azienda,
    anno,
    magazzino,

    async getJson(path) {
      const execute = async () => {
        const response = await request({ url: `${baseUrl}/webapi/risorse${path}`, headers });
        const payload = parseJsonResponse(response, path);
        this.lastHttpStatus = response.status;
        return payload;
      };
      return retryOptions
        ? withTransientMexalRetry(execute, retryOptions)
        : execute();
    },

    async postJson(path, payload, { onDiagnostic } = {}) {
      const url = `${baseUrl}/webapi/risorse${path}`;
      const body = JSON.stringify(payload);
      const requestHeaders = {
        ...headers,
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
      };

      // The callback is deliberately invoked immediately before the outbound request so
      // order diagnostics always describe the exact serialized bytes sent to Mexal.
      onDiagnostic?.({ phase: "request", url, method: "POST", headers: requestHeaders, body });

      try {
        const response = await request({ url, headers, method: "POST", body });
        onDiagnostic?.({ phase: "response", url, method: "POST", status: response.status, headers: response.headers, body: response.body });
        const result = parseJsonResponse(response, path);
        this.lastHttpStatus = response.status;
        // Preserve the JSON return value for existing callers while retaining the
        // HTTP response that identifies resources created with an empty body.
        // This is deliberately non-enumerable so response persistence/logging
        // keeps its previous body-only shape.
        if (result && typeof result === "object") {
          Object.defineProperty(result, "mexalHttpResponse", {
            value: response,
            enumerable: false,
            configurable: true,
          });
        }
        return result;
      } catch (error) {
        if (!error?.mexalResponse) onDiagnostic?.({ phase: "transport_error", url, method: "POST", error: error?.message || String(error) });
        throw error;
      }
    },

    async getBinary(path) {
      const response = await request({
        url: `${baseUrl}/webapi/risorse${path}`,
        headers,
        binary: true,
      });

      if (response.status < 200 || response.status >= 300) {
        throw new Error(`${path}: HTTP ${response.status}`);
      }

      return response;
    },
  };
}

const ORDERS_ROLES = new Set(["backoffice", "area_manager", "agente"]);

function authorizationError(message, status, details = {}) {
  return Object.assign(new Error(message), { status, ...details });
}

function logOrdersAuthorization(authUserId, reason, profilesFound) {
  console.warn("Mexal orders authorization denied", {
    auth_user_id: authUserId || null,
    reason,
    profiles_found: profilesFound,
  });
}

export async function verifyUser(req, supabase, { allowOrdersUser = false } = {}) {
  const authorization = req.headers.authorization || "";
  const cronSecret = process.env.CRON_SECRET?.trim();

  if (cronSecret && authorization === `Bearer ${cronSecret}`) {
    return;
  }

  if (!authorization.startsWith("Bearer ")) throw authorizationError("Sessione mancante.", 401);

  const token = authorization.slice(7);

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser(token);

  if (authError || !user) throw authorizationError("Sessione non valida.", 401);

  const { data: profiles, error: profileError } = await supabase
    .from("utenti")
    .select("id,attivo,ruoli(nome,amministratore_workspace)")
    .eq("auth_user_id", user.id)
    .limit(2);

  const profilesFound = profiles?.length || 0;
  if (profileError) {
    console.error("Mexal orders profile lookup failed", { auth_user_id: user.id, error: profileError.message });
    throw authorizationError("Errore verifica profilo utente.", 500);
  }
  if (profilesFound > 1) {
    logOrdersAuthorization(user.id, "duplicate_profile", profilesFound);
    throw authorizationError("Configurazione profilo utente incoerente.", 409);
  }
  if (!profilesFound) {
    logOrdersAuthorization(user.id, "missing_profile", profilesFound);
    throw authorizationError("Utente non autorizzato alla gestione ordini.", 403);
  }

  const profile = profiles[0];
  if (profile.attivo === false) {
    logOrdersAuthorization(user.id, "inactive_profile", profilesFound);
    throw authorizationError("Utente disattivato.", 403);
  }

  const isAdmin = profile.ruoli?.amministratore_workspace === true;

  if (isAdmin) return { authUserId: user.id, profile, isAdmin: true, integration: null };

  const { data: integrations, error: integrationError } = await supabase
    .from("integrazioni_utenti")
    .select("modulo,enabled,ruolo_ordini")
    .eq("utente_id", profile.id)
    .in("modulo", ["gestione_ordini_pr", "gestione_ordini_ph", "gestione_ordini_private"]);

  if (integrationError) {
    console.error("Mexal orders integration lookup failed", { auth_user_id: user.id, error: integrationError.message });
    throw authorizationError("Errore verifica autorizzazione Gestione Ordini.", 500);
  }
  const integration = (integrations || []).find((row) => row.enabled === true);
  const hasOrdersAccess = integration?.enabled === true;
  const ordersRole = String(integration?.ruolo_ordini || "").toLowerCase();

  const isBackoffice =
    hasOrdersAccess && ordersRole === "backoffice";

  if (allowOrdersUser && hasOrdersAccess && ORDERS_ROLES.has(ordersRole)) {
    return { authUserId: user.id, profile, isAdmin: false, integration };
  }

  if (!isBackoffice) {
    logOrdersAuthorization(user.id, hasOrdersAccess ? "unsupported_orders_role" : "orders_access_disabled", profilesFound);
    throw authorizationError("Accesso Ordini non abilitato per questo utente.", 403);
  }

  return { authUserId: user.id, profile, isAdmin: false, integration };
}

export function isWorkspaceProductCode(code) {
  const normalized = normalizeCode(code);

  return PRODUCT_UI_PREFIXES.some((prefix) =>
    normalized.startsWith(prefix)
  );
}

export function getAvailabilityWarehouse(code) {
  return isWorkspaceProductCode(code) ? STOCK_WAREHOUSE : null;
}

export function selectAvailabilityClient(code, clients) {
  return getAvailabilityWarehouse(code) === STOCK_WAREHOUSE
    ? clients.warehouse5
    : clients.allWarehouses;
}
export function isActiveArticle(article) {
  const annulled = String(
    article?.gest_annullato ??
      article?.annullato ??
      article?.articolo_annullato ??
      "N"
  )
    .trim()
    .toUpperCase();

  const preCancelled = String(
    article?.gest_precanc ??
      article?.precancellato ??
      article?.articolo_precancellato ??
      "N"
  )
    .trim()
    .toUpperCase();

  return (
    Boolean(getArticleCode(article)) &&
    annulled !== "S" &&
    annulled !== "Y" &&
    annulled !== "TRUE" &&
    annulled !== "1" &&
    preCancelled !== "S" &&
    preCancelled !== "Y" &&
    preCancelled !== "TRUE" &&
    preCancelled !== "1"
  );
}

function buildName(article) {
  const description = String(article?.descrizione || "").trimEnd();
  const additionalDescription = String(article?.descrizione_agg || "").trimStart();

  // In Mexal descrizione_agg è la continuazione del campo descrizione.
  // Non va inserito uno spazio artificiale tra i due segmenti.
  return `${description}${additionalDescription}`
    .replace(/\s+/g, " ")
    .trim();
}

function getListPrice(prices, preferredList = 1) {
  if (!Array.isArray(prices)) return null;

  const exact = prices.find(
    (row) =>
      Array.isArray(row) &&
      Number(row[0]) === preferredList
  );

  const candidate =
    exact || prices.find((row) => Array.isArray(row));

  return candidate ? nullableNumber(candidate[1]) : null;
}

export function calculateStock(article) {
  return round4(
    numberValue(article?.qta_inventario) +
      numberValue(article?.qta_carico) -
      numberValue(article?.qta_scarico)
  );
}

export function calculateAvailability(article, stock) {
  return round4(
    stock +
      numberValue(article?.ord_fornitori) +
      numberValue(article?.ord_produzione) -
      numberValue(article?.ord_cli_e) -
      numberValue(article?.ord_cli_sps) -
      numberValue(article?.ord_cli_auto)
  );
}

function resolveHierarchy(groupCode, groupMap) {
  const chain = [];
  const visited = new Set();
  let current = String(groupCode || "").trim();

  while (current && !visited.has(current)) {
    visited.add(current);

    const group = groupMap.get(current);
    if (!group) break;

    chain.unshift(group);
    current = String(group.cod_grp_merc || "").trim();
  }

  return {
    brand: chain[0] || null,
    linea: chain[1] || null,
    categoria: chain[2] || null,
    sottocategoria:
      chain.length >= 4 ? chain[chain.length - 1] : null,
  };
}

function isOutOfProductionLine(lineDescription) {
  return String(lineDescription || "")
    .trim()
    .toLocaleLowerCase("it-IT")
    .includes("fuori produzione");
}

function detectImageMime(buffer, header) {
  const normalized = String(header || "").toLowerCase();

  if (normalized.includes("png")) {
    return { mime: "image/png", extension: "png" };
  }

  if (normalized.includes("webp")) {
    return { mime: "image/webp", extension: "webp" };
  }

  if (buffer?.[0] === 0x89 && buffer?.[1] === 0x50) {
    return { mime: "image/png", extension: "png" };
  }

  return { mime: "image/jpeg", extension: "jpg" };
}

async function ensureImageBucket(supabase) {
  const { data, error } = await supabase.storage.listBuckets();

  if (error) throw error;

  const bucket = data?.find(
    (item) => item.name === STORAGE_BUCKET
  );

  if (!bucket) {
    const { error: createError } =
      await supabase.storage.createBucket(STORAGE_BUCKET, {
        public: true,
        fileSizeLimit: 10 * 1024 * 1024,
        allowedMimeTypes: [
          "image/jpeg",
          "image/png",
          "image/webp",
        ],
      });

    if (createError) throw createError;
  } else if (!bucket.public) {
    const { error: updateError } =
      await supabase.storage.updateBucket(STORAGE_BUCKET, {
        public: true,
        fileSizeLimit: 10 * 1024 * 1024,
        allowedMimeTypes: [
          "image/jpeg",
          "image/png",
          "image/webp",
        ],
      });

    if (updateError) throw updateError;
  }
}

async function syncCatalogImage({
  supabase,
  mexal,
  article,
  code,
}) {
  if (
    String(article?.img_cat_disp || "N")
      .trim()
      .toUpperCase() !== "S"
  ) {
    return null;
  }

  const response = await mexal.getBinary(
    `/articoli/${encodeURIComponent(
      code
    )}/allegati/immagine-catalogo`
  );

  const { mime, extension } = detectImageMime(
    response.body,
    response.headers["content-type"]
  );

  const safeCode = code.replace(
    /[^a-zA-Z0-9._-]/g,
    "_"
  );

  const storagePath =
    `${safeCode}/catalogo.${extension}`;

  /*
   * Opzione C:
   * 1. elimina sempre il file precedente;
   * 2. carica la nuova immagine con lo stesso nome;
   * 3. aggiunge un parametro di versione all'URL pubblico
   *    per forzare l'aggiornamento della cache su browser e smartphone.
   */
  const { error: removeError } = await supabase.storage
    .from(STORAGE_BUCKET)
    .remove([storagePath]);

  if (removeError) {
    console.warn(
      `Impossibile eliminare l'immagine precedente ${storagePath}:`,
      removeError.message
    );
  }

  const { error } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(storagePath, response.body, {
      contentType: mime,
      cacheControl: "0",
      upsert: true,
    });

  if (error) throw error;

  const publicUrl = supabase.storage
    .from(STORAGE_BUCKET)
    .getPublicUrl(storagePath).data.publicUrl;

  return `${publicUrl}?v=${Date.now()}`;
}

export function extractArticleRows(response) {
  const candidates = [
    response,
    response?.dati,
    response?.articoli,
    response?.records,
    response?.items,
    response?.data?.articoli,
    response?.data?.dati,
    response?.risposta?.articoli,
  ];
  return candidates.find(Array.isArray) || [];
}

function limitedShape(value) {
  if (!value || typeof value !== "object") return typeof value;
  return Object.keys(value).slice(0, 12);
}

function listDiagnostics({ endpoint, status, payload, rows }) {
  return {
    endpoint,
    http_status: status,
    payload_type: Array.isArray(payload) ? "array" : typeof payload,
    root_keys: payload && typeof payload === "object" && !Array.isArray(payload) ? Object.keys(payload).slice(0, 20) : [],
    candidate_paths: ["root", "dati", "articoli", "records", "items", "data.articoli", "data.dati", "risposta.articoli"],
    received_elements: rows.length,
    first_element_shape: limitedShape(rows[0]),
    first_extracted_code: getArticleCode(rows[0]),
  };
}

export async function getAllArticles(mexal) {
  const allRows = [];
  let next = null;
  let page = 0;

  do {
    const params = new URLSearchParams();
    params.set("max", "500");
    params.set("fields", "codice,gest_annullato,gest_precanc");

    if (next) {
      params.set("next", next);
    }

    const response = await mexal.getJson(`/articoli?${params.toString()}`);
    const rows = extractArticleRows(response);
    if (page === 0) {
      allRows.diagnostics = listDiagnostics({
        endpoint: "/webapi/risorse/articoli?max=500&fields=codice,gest_annullato,gest_precanc",
        status: mexal.lastHttpStatus || null,
        payload: response,
        rows,
      });
    }

    allRows.push(...rows);
    next = response?.next ? String(response.next) : null;
    page += 1;

    if (page > 200) {
      throw new Error("Paginazione articoli Mexal interrotta: troppe pagine.");
    }
  } while (next);

  // The master-data sync must include every article code. Active state is
  // checked on the complete detail record before either destination is written.
  const filtered = allRows
    .map((row) => ({ row, code: getArticleCode(row) }))
    .filter(({ code }) => Boolean(code))
    .sort((a, b) => a.code.localeCompare(b.code))
    .map(({ row }) => row);
  filtered.diagnostics = { ...(allRows.diagnostics || {}), allowed_by_filters: filtered.length };
  return filtered;
}

export function buildArticleDetailPath(code) {
  const resourceCode = encodeURIComponent(String(code));

  // The Mexal HTTP gateway decodes the path once before routing the resource.
  // Protect the already encoded resource key for that transport boundary, so
  // reserved characters reach /articoli/{codice} without becoming separators.
  const transportCode = resourceCode.replaceAll("%", "%25");
  return `/articoli/${transportCode}`;
}

async function getGroupMap(mexal) {
  const response = await mexal.getJson(
    "/dati-generali/gruppi-merceologici"
  );

  const groups = extractArticleRows(response);

  return new Map(
    groups.map((group) => [
      String(group.codice || "").trim(),
      group,
    ])
  );
}

export async function loadFullArticle(mexal, code, fallback) {
  const response = await mexal.getJson(buildArticleDetailPath(code));

  if (
    response &&
    typeof response === "object" &&
    !Array.isArray(response)
  ) {
    if (
      response.dati &&
      !Array.isArray(response.dati)
    ) {
      return response.dati;
    }

    return response;
  }

  return fallback;
}

async function findExistingProduct(supabase, code) {
  const { data, error } = await supabase
    .from("prodotti")
    .select("id,immagine_catalogo_url")
    .eq("codice_mexal", code)
    .maybeSingle();

  if (error) throw error;

  return data || null;
}

async function saveProduct({
  supabase,
  article,
  hierarchy,
  imageUrl,
  existing,
}) {
  const code = getArticleCode(article);

  if (!code) {
    throw new Error(
      "Codice articolo Mexal mancante nel record completo."
    );
  }

  const name = buildName(article) || code;
  const stock = calculateStock(article);
  const now = new Date().toISOString();

  const vat = getMexalVat(article);
  const payload = {
    nome: name,
    codice: code,
    codice_mexal: code,
    descrizione:
      String(article.descr_completa || "").trim() ||
      name,
    brand: hierarchy.brand?.descrizione || null,
    categoria:
      hierarchy.categoria?.descrizione ||
      hierarchy.linea?.descrizione ||
      null,
    sottocategoria:
      hierarchy.sottocategoria?.descrizione || null,
    brand_mexal:
      hierarchy.brand?.descrizione || null,
    linea_mexal:
      hierarchy.linea?.descrizione || null,
    categoria_mexal:
      hierarchy.categoria?.descrizione || null,
    sottocategoria_mexal:
      hierarchy.sottocategoria?.descrizione || null,
    ean:
      String(article.cod_alternativo || "").trim() ||
      null,
    prezzo_listino: getListPrice(
      article.prz_listino,
      1
    ),
    costo_ultimo: getLastCost(article),
    // The complete /articoli/{codice} payload exposes the VAT value as alq_iva
    // (for example "22,0").  It is both Mexal's VAT code and the source of
    // the percentage; list records do not contain this authoritative value.
    codice_iva_mexal: vat.code,
    aliquota_iva: vat.rate,
    giacenza: stock,
    disponibilita: calculateAvailability(
      article,
      stock
    ),
    immagine_url: null,
    icona_url: null,
    immagine_catalogo_url:
      imageUrl ??
      existing?.immagine_catalogo_url ??
      null,
    mostra_in_app: true,
    sincronizzato_mexal: true,
    attivo_mexal: true,
    attivo: true,
    stato: "Attivo",
    ultimo_sync_mexal: now,
    json_mexal: article,
    ...(nullableInteger(article.id_categoria_pr) !== null ? { categoria_provvigionale_mexal: nullableInteger(article.id_categoria_pr) } : {}),
    updated_at: now,
  };

  if (existing?.id) {
    const { error } = await supabase
      .from("prodotti")
      .update(payload)
      .eq("id", existing.id);

    if (error) throw error;

    return "updated";
  }

  const { error } = await supabase
    .from("prodotti")
    .insert(payload);

  if (error) throw error;

  return "inserted";
}

export function mapArticleToOrdersCache(article, { imageUrl = null } = {}) {
  const code = getArticleCode(article);
  if (!code) throw new Error("Codice articolo Mexal mancante nel record completo.");
  const stock = calculateStock(article);

  const vat = getMexalVat(article);
  return {
    codice_articolo: code,
    descrizione: buildName(article) || code,
    descrizione_completa: nullableText(article.descr_completa),
    codice_alternativo: nullableText(article.cod_alternativo),
    unita_misura: authoritativeArticleUnit(article),
    codice_iva_mexal: vat.code,
    aliquota_iva: vat.rate,
    categoria_sconto: nullableInteger(
      article.id_cat_sconto ?? article.categoria_sconto ?? article.cod_cat_sconto
    ),
    categoria_prezzo: nullableInteger(
      article.id_cat_prezzo ?? article.categoria_prezzo ?? article.cod_cat_prezzo
    ),
    ...(nullableInteger(article.id_categoria_pr) !== null ? { categoria_provvigionale_mexal: nullableInteger(article.id_categoria_pr) } : {}),
    prezzo_listino: getListPrice(article.prz_listino, 1),
    costo_ultimo: getLastCost(article),
    giacenza: stock,
    impegnato: round4(
      numberValue(article.impegnato ?? article.qta_impegnata ?? 0)
    ),
    disponibilita: calculateAvailability(article, stock),
    mostra_in_app: true,
    immagine_url: imageUrl,
    scheda_tecnica_url: nullableText(
      article.scheda_tecnica_url,
      article.url_scheda_tecnica
    ),
    materiale_pubblicitario_url: nullableText(
      article.materiale_pubblicitario_url,
      article.url_materiale_pubblicitario
    ),
    dati_mexal: article,
    sincronizzato_il: new Date().toISOString(),
  };
}

export function mapArticleWarehouseStock(article, warehouse, { fallback = {}, syncRunId = null, synchronizedAt = new Date().toISOString() } = {}) {
  const code = getArticleCode(article) || getArticleCode(fallback);
  if (!code) throw new Error("Codice articolo mancante nel progressivo di magazzino Mexal.");
  const stock = calculateStock(article);
  const committed = round4(numberValue(article.impegnato ?? article.qta_impegnata ?? 0));
  return {
    article_code: code,
    warehouse_number: warehouse.number,
    warehouse_name: warehouse.name,
    unit_of_measure: authoritativeArticleUnit(article) || authoritativeArticleUnit(fallback),
    on_hand: stock,
    committed,
    available: calculateAvailability(article, stock),
    unit_cost: getLastCost(article) || getLastCost(fallback),
    source_payload: article,
    sync_run_id: syncRunId,
    synchronized_at: synchronizedAt,
    is_current: true,
  };
}

async function saveArticleWarehouseStocks(supabase, articleCode, rows) {
  if (!rows.length) throw new Error(`Nessun progressivo per magazzino ricevuto per ${articleCode}.`);
  const { error: upsertError } = await supabase.from("workspace_warehouse_stock")
    .upsert(rows, { onConflict: "article_code,warehouse_number" });
  if (upsertError) throw upsertError;
  const currentNumbers = rows.map((row) => row.warehouse_number);
  const { error: staleError } = await supabase.from("workspace_warehouse_stock")
    .update({ is_current: false }).eq("article_code", articleCode)
    .not("warehouse_number", "in", `(${currentNumbers.join(",")})`);
  if (staleError) throw staleError;
}

async function upsertOrdersProductsCache(supabase, rows) {
  if (!rows.length) return { inserted: 0, updated: 0 };
  const codes = rows.map((row) => row.codice_articolo);
  const { data: existing, error: existingError } = await supabase
    .from("ordini_prodotti_cache")
    .select("codice_articolo")
    .in("codice_articolo", codes);
  if (existingError) throw existingError;
  const existingCodes = new Set((existing || []).map((row) => normalizeCode(row.codice_articolo)));
  const { error } = await supabase
    .from("ordini_prodotti_cache")
    .upsert(rows, { onConflict: "codice_articolo" });
  if (error) throw error;
  const updated = rows.filter((row) => existingCodes.has(row.codice_articolo)).length;
  return { inserted: rows.length - updated, updated };
}

async function createSyncRun(supabase, metadata) {
  const { origin, context, ...runMetadata } = metadata;
  const run = await createCentralSyncRun(supabase, {
    syncType: "products",
    source: origin === "cron" ? "cron" : "manual",
    context: context || {},
    metadata: runMetadata,
  });
  if (run.duplicate) throw Object.assign(new Error("È già presente una sincronizzazione prodotti in corso."), { status: 409 });
  return { ...run, processed: 0, inserted: 0, updated: 0, skipped: 0, failed: 0, metadata: runMetadata };
}

async function getSyncRun(supabase, id) {
  const { data, error } = await supabase
    .from("mexal_sync_runs")
    .select("id,started_at,status,processed,inserted,updated,skipped,failed,metadata")
    .eq("id", id)
    .eq("sync_type", "products")
    .maybeSingle();

  if (error) throw error;
  if (!data) {
    throw new Error("Run di sincronizzazione prodotti non trovata.");
  }

  return data;
}

async function assertRunStillRunning(supabase, id, syncType) {
  const { data, error } = await supabase.from("mexal_sync_runs").select("status").eq("id", id).eq("sync_type", syncType).maybeSingle();
  if (error) throw error;
  if (!data || data.status !== "running") throw new Error("La run di sincronizzazione è stata arrestata manualmente.");
}

async function updateSyncRun(supabase, id, values) {
  if (!id) return;
  const { data: current, error: readError } = await supabase
    .from("mexal_sync_runs")
    .select("processed,inserted,updated,skipped,failed,metadata")
    .eq("id", id)
    .eq("sync_type", "products")
    .maybeSingle();
  if (readError) {
    console.error("Lettura run prodotti non riuscita", { runId: id, message: readError.message });
    return;
  }
  const counters = values.counters;
  const payload = { ...values };
  const terminalStatus = payload.status;
  delete payload.counters;
  delete payload.status;
  delete payload.completed_at;
  if (payload.metadata && current) {
    payload.metadata = { ...(current.metadata || {}), ...payload.metadata };
  }
  if (counters && current) {
    payload.processed = Number(current.processed || 0) + Number(counters.processed || 0);
    payload.inserted = Number(current.inserted || 0) + Number(counters.inserted || 0);
    payload.updated = Number(current.updated || 0) + Number(counters.updated || 0);
    payload.skipped = Number(current.skipped || 0) + Number(counters.skipped || 0);
    payload.failed = Number(current.failed || 0) + Number(counters.failed || 0);
  }
  if (terminalStatus === "completed") {
    await completeSyncRun(supabase, id, payload);
    return;
  }
  if (terminalStatus === "failed") {
    await failSyncRun(supabase, id, payload.error_message, payload);
    return;
  }
  const { error } = await supabase
    .from("mexal_sync_runs")
    .update(payload)
    .eq("id", id)
    .eq("sync_type", "products")
    .eq("status", "running");
  if (error) console.error("Aggiornamento run prodotti non riuscito", { runId: id, message: error.message });
}

async function reconcileStaleProducts(supabase, startedAt) {
  const now = new Date().toISOString();
  const { count, error } = await supabase
    .from("prodotti")
    .update({
      mostra_in_app: false,
      attivo: false,
      attivo_mexal: false,
      stato: "Non attivo",
      updated_at: now,
    }, { count: "exact" })
    .eq("sincronizzato_mexal", true)
    .or(`ultimo_sync_mexal.lt.${startedAt},ultimo_sync_mexal.is.null`);

  if (error) throw error;
  return count || 0;
}
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Metodo non consentito.",
    });
  }

  let supabase;
  let syncRunId = null;
  let syncRun = null;
  let action = null;
  try {
    supabase = createClient(
      requireEnv("SUPABASE_URL"),
      requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
      {
        auth: {
          persistSession: false,
        },
      }
    );

    const body =
      typeof req.body === "object" && req.body
        ? req.body
        : {};

    action = body.action || "test";

    const authorization = await verifyUser(req, supabase, {
      // Le sincronizzazioni automatiche possono essere avviate da qualunque
      // utente abilitato al modulo. Il lock centralizzato evita duplicazioni.
      allowOrdersUser: action === "sync-stock-it" || action === "sync",
    });

    const articlePrefix = normalizeTargetedArticlePrefix(
      body.articlePrefix ?? body.prefix
    );
    if (articlePrefix && !["test", "sync"].includes(action)) {
      throw Object.assign(
        new Error("Il prefisso articolo è ammesso solo per test o sincronizzazione prodotti."),
        { status: 400 },
      );
    }
    if (articlePrefix && authorization?.isAdmin !== true) {
      throw Object.assign(
        new Error("La sincronizzazione mirata articoli richiede un amministratore Workspace."),
        { status: 403 },
      );
    }

    const offset = Math.max(
      0,
      Number(body.offset || 0)
    );

    const batchSize = Math.min(
      MAX_BATCH_SIZE,
      Math.max(
        1,
        Number(
          body.batchSize || DEFAULT_BATCH_SIZE
        )
      )
    );

    if (action === "sync") {
      syncRunId = body.syncRunId || null;
      if (!syncRunId && offset === 0) {
        syncRun = await createSyncRun(supabase, {
          batch_size: batchSize,
          article_prefix: articlePrefix,
          origin: body.origin || "manual",
          context: body.context || {},
        });
        syncRunId = syncRun.id;
      } else if (syncRunId) {
        syncRun = await getSyncRun(supabase, syncRunId);
      }
      if (!syncRunId) {
        throw new Error("Identificativo della sincronizzazione prodotti mancante.");
      }
      if (syncRun.status !== "running") {
        throw new Error("La run di sincronizzazione prodotti non è più in esecuzione.");
      }
      const runPrefix = normalizeTargetedArticlePrefix(
        syncRun.metadata?.article_prefix
      );
      if (runPrefix !== articlePrefix) {
        throw Object.assign(
          new Error("Il prefisso articolo non coincide con quello della run avviata."),
          { status: 409 },
        );
      }
    }

    const stockRetryOptions = action === "sync-stock-it" ? {} : undefined;
    const mexal = buildMexalClient({ retryOptions: stockRetryOptions });
    const availabilityClients = {
      warehouse5: Number(mexal.magazzino) === STOCK_WAREHOUSE
        ? mexal
        : buildMexalClient({ warehouse: STOCK_WAREHOUSE, retryOptions: stockRetryOptions }),
      allWarehouses: buildMexalClient({ warehouse: null, retryOptions: stockRetryOptions }),
    };
    let warehouseCatalog = [];
    let warehouseClients = new Map();
    if (action === "sync-stock-it") {
      warehouseCatalog = await loadMexalWarehouses(availabilityClients.allWarehouses);
      warehouseClients = new Map(warehouseCatalog.map((warehouse) => [
        warehouse.number,
        buildMexalClient({ warehouse: warehouse.number, retryOptions: stockRetryOptions }),
      ]));
    }

    const [allArticles, groupMap] =
      await Promise.all([
        getAllArticles(mexal),
        getGroupMap(mexal),
      ]);
    const articles = filterArticlesByPrefix(allArticles, articlePrefix);

    if (action === "test") {
      return res.status(200).json({
        ambiente: {
          base_url: mexal.baseUrl,
          azienda: mexal.azienda,
          anno: mexal.anno,
          magazzino: mexal.magazzino,
        },
        letti_mexal: allArticles.length,
        selezionati: articles.length,
        prefisso_articoli: articlePrefix,
        inseriti: 0,
        aggiornati: 0,
        immagini_salvate: 0,
        errori: [],
        dry_run: true,
        messaggio:
          "Connessione verificata. Trovati gli articoli con codice valido. Lo stato attivo viene verificato sul record completo durante la sincronizzazione.",
      });
    }

    if (action === "sync-stock-it") {
      syncRunId = body.syncRunId ? Number(body.syncRunId) : null;
      if (!syncRunId && offset === 0) {
        const stockRun = await createCentralSyncRun(supabase, { syncType: "stocks", source: ["manual", "cron"].includes(body.origin) ? body.origin : "manual", context: body.context || {}, metadata: { stock_state_version: 2, batch_size: batchSize, next_offset: 0, checkpointed_at: new Date().toISOString() } });
        if (stockRun.duplicate) return res.status(409).json({ error: "È già presente una sincronizzazione giacenze in corso.", sync_run_id: Number(stockRun.id) });
        syncRunId = stockRun.id;
      }
      if (!Number.isSafeInteger(syncRunId)) throw new Error("Identificativo run giacenze non valido.");
      const activeRun = await findRunningSync(supabase, "stocks");
      if (activeRun && Number(activeRun.id) !== syncRunId) return res.status(409).json({ error: "È già presente una sincronizzazione giacenze in corso.", sync_run_id: Number(activeRun.id) });
      const currentRun = activeRun && Number(activeRun.id) === syncRunId ? activeRun : await getCentralSyncRun(supabase, syncRunId);
      if (!currentRun) throw Object.assign(new Error("Run giacenze non trovata."), { status: 404 });
      if (currentRun.status !== "running") {
        const terminalPayload = {
          totale: Number(currentRun.metadata?.total || currentRun.processed || 0),
          elaborati: 0,
          elaborati_totali: Number(currentRun.processed || 0),
          offset: Number(currentRun.processed || 0),
          prossimo_offset: Number(currentRun.processed || 0),
          completato: currentRun.status === "completed",
          aggiornati: 0,
          aggiornati_totali: Number(currentRun.updated || 0),
          errori: [],
          errori_totali: Number(currentRun.failed || 0),
          sync_run_id: Number(syncRunId),
          stato_run: currentRun.status,
          replay: true,
        };
        if (currentRun.status !== "completed") return res.status(409).json({ ...terminalPayload, error: currentRun.error_message || `Run giacenze chiusa con stato ${currentRun.status}.` });
        return res.status(200).json(terminalPayload);
      }
      const stockArticles = articles;
      const state = stockRunState(currentRun, { batchSize, total: stockArticles.length });
      if (shouldReplayStockCheckpoint({ requestedOffset: offset, resume: body.resume === true, state })) {
        return res.status(200).json({ totale: stockArticles.length, elaborati: 0, elaborati_totali: state.processed, offset: state.nextOffset, prossimo_offset: state.nextOffset, completato: state.nextOffset >= stockArticles.length, aggiornati: 0, aggiornati_totali: state.updated, errori: [], errori_totali: state.failed, sync_run_id: Number(syncRunId), replay: true, stale: state.stale });
      }
      const authoritativeOffset = state.nextOffset;
      const batch = stockArticles.slice(authoritativeOffset, authoritativeOffset + state.batchSize);
      const result = { totale: stockArticles.length, elaborati: batch.length, offset: authoritativeOffset, prossimo_offset: authoritativeOffset + batch.length, completato: authoritativeOffset + batch.length >= stockArticles.length, aggiornati: 0, esclusi: 0, errori: [] };
      const updateOperations = [];
      for (const summary of batch) {
        await assertRunStillRunning(supabase, syncRunId, "stocks");
        const code = getArticleCode(summary);
        try {
          const availabilityMexal = selectAvailabilityClient(code, availabilityClients);
          const article = await loadFullArticle(availabilityMexal, code, summary);
          if (!isActiveArticle(article)) { result.esclusi += 1; continue; }
          const stock = calculateStock(article); const now = new Date().toISOString();
          const availability = calculateAvailability(article, stock);
          const lastCost = getLastCost(article);
          const committed = round4(numberValue(article.impegnato ?? article.qta_impegnata ?? 0));
          const unit = authoritativeArticleUnit(article);
          const synchronizedAt = new Date().toISOString();
          const warehouseRows = [];
          for (const warehouse of warehouseCatalog) {
            const warehouseArticle = await loadFullArticle(warehouseClients.get(warehouse.number), code, summary);
            warehouseRows.push(mapArticleWarehouseStock(warehouseArticle, warehouse, {
              fallback: article,
              syncRunId,
              synchronizedAt,
            }));
          }
          await saveArticleWarehouseStocks(supabase, code, warehouseRows);
          const { data: updatedRows, error: updateError } = await supabase.from("prodotti").update({ giacenza: stock, disponibilita: availability, costo_ultimo: lastCost, ultimo_sync_mexal: now, updated_at: now }).eq("codice_mexal", code).eq("sincronizzato_mexal", true).eq("attivo_mexal", true).select("id");
          if (updateError) throw updateError;
          const { error: cacheUpdateError } = await supabase.from("ordini_prodotti_cache").update({ giacenza: stock, impegnato: committed, disponibilita: availability, costo_ultimo: lastCost, unita_misura: unit, dati_mexal: article, sincronizzato_il: now }).eq("codice_articolo", code);
          if (cacheUpdateError) throw cacheUpdateError;
          result.aggiornati += updatedRows?.length || 0;
          for (const row of updatedRows || []) updateOperations.push({ id: row.id, code });
        } catch (error) {
          if (error?.retryable === true) {
            error.stockUpdateDiagnostics = stockUpdateDiagnostics(currentRun.metadata, updateOperations);
            throw error;
          }
          result.errori.push({ codice: code || "senza codice", errore: error?.message || String(error) });
        }
      }
      const updateAudit = stockUpdateDiagnostics(currentRun.metadata, updateOperations);
      const checkpoint = stockBatchCheckpoint(currentRun, { processed: result.elaborati, updated: result.aggiornati, skipped: result.esclusi, failed: result.errori.length }, { total: stockArticles.length, batchSize: state.batchSize, metadata: { stock_update_diagnostics: updateAudit } });
      const persisted = await checkpointSyncRunProgress(supabase, syncRunId, checkpoint.expectedProcessed, checkpoint.values);
      if (!persisted.advanced) {
        const concurrent = stockRunState(persisted.run, { batchSize: state.batchSize, total: stockArticles.length });
        return res.status(200).json({ totale: stockArticles.length, elaborati: 0, elaborati_totali: concurrent.processed, offset: concurrent.nextOffset, prossimo_offset: concurrent.nextOffset, completato: persisted.run.status === "completed" || concurrent.nextOffset >= stockArticles.length, aggiornati: 0, aggiornati_totali: concurrent.updated, errori: [], errori_totali: concurrent.failed, sync_run_id: Number(syncRunId), replay: true, stale: concurrent.stale });
      }
      const persistedState = stockRunState(persisted.run, { total: stockArticles.length });
      result.prossimo_offset = persistedState.nextOffset;
      result.completato = persistedState.nextOffset >= stockArticles.length;
      if (result.completato && persistedState.failed > 0) {
        const message = "Sincronizzazione giacenze completata con errori reali.";
        await failSyncRun(supabase, syncRunId, message, { processed: persistedState.processed, updated: persistedState.updated, skipped: persistedState.skipped, failed: persistedState.failed, metadata: persisted.run.metadata });
        return res.status(422).json({ ...result, error: message, elaborati_totali: persistedState.processed, aggiornati_totali: persistedState.updated, errori_totali: persistedState.failed, sync_run_id: Number(syncRunId), stato_run: "failed" });
      }
      if (result.completato) await completeSyncRun(supabase, syncRunId, { processed: persistedState.processed, updated: persistedState.updated, skipped: persistedState.skipped, failed: 0, metadata: persisted.run.metadata, error_message: null });
      const persistedAudit = persisted.run.metadata?.stock_update_diagnostics || updateAudit;
      return res.status(200).json({ ...result, elaborati_totali: persistedState.processed, aggiornati_totali: persistedState.updated, operazioni_aggiornamento_totali: Number(persistedAudit.update_operations_total || persistedState.updated), prodotti_aggiornati_univoci: Number(persistedAudit.unique_product_ids_count || 0), update_ripetuti: Number(persistedAudit.repeated_update_operations || 0), errori_totali: persistedState.failed, sync_run_id: Number(syncRunId), stale: state.stale, resumed: state.processed > 0 || state.legacy });
    }

    if (action !== "sync") {
      return res.status(400).json({
        error: "Azione non valida.",
      });
    }

    // Non invalidare mai il catalogo all'avvio: ogni lotto aggiorna soltanto
    // gli articoli ricevuti. Una sync interrotta lascia intatti i record già visibili.
    if (offset === 0) await ensureImageBucket(supabase);
    const batch = articles.slice(
      offset,
      offset + batchSize
    );

    const result = {
      totale: articles.length,
      elaborati: batch.length,
      offset,
      prossimo_offset: offset + batch.length,
      completato:
        offset + batch.length >= articles.length,
      inseriti: 0,
      aggiornati: 0,
      prodotti_inseriti: 0,
      prodotti_aggiornati: 0,
      immagini_salvate: 0,
      esclusi_non_attivi: 0,
      esclusi_fuori_produzione: 0,
      disattivati: 0,
      errori: [],
      sync_run_id: syncRunId,
      received: allArticles.length,
      filtered: articles.length,
      prefisso_articoli: articlePrefix,
      detail_loaded: 0,
      righe_mappate: 0,
      righe_scritte: 0,
      destinazione: "ordini_prodotti_cache",
      diagnostics: articles.diagnostics || {},
    };

    const mappedByCode = new Map();
    for (const summary of batch) {
      await assertRunStillRunning(supabase, syncRunId, "products");
      const code = getArticleCode(summary);
      try {
        if (!code) continue;
        const availabilityMexal = selectAvailabilityClient(code, availabilityClients);
        const article = await loadFullArticle(availabilityMexal, code, summary);
        result.detail_loaded += 1;
        if (!isActiveArticle(article)) { result.esclusi_non_attivi += 1; continue; }
        const hierarchy = resolveHierarchy(article.cod_grp_merc, groupMap);
        if (isOutOfProductionLine(hierarchy.linea?.descrizione)) { result.esclusi_fuori_produzione += 1; continue; }
        const existing = await findExistingProduct(supabase, code);
        let imageUrl = existing?.immagine_catalogo_url || null;
        if (String(article?.img_cat_disp || "N").trim().toUpperCase() === "S") {
          try {
            imageUrl = await syncCatalogImage({ supabase, mexal: availabilityMexal, article, code });
            if (imageUrl) result.immagini_salvate += 1;
          } catch (imageError) {
            result.errori.push({ codice: code, errore: `Immagine catalogo: ${imageError.message}` });
          }
        }
        const productOperation = await saveProduct({ supabase, article, hierarchy, imageUrl, existing });
        if (productOperation === "inserted") result.prodotti_inseriti += 1;
        else result.prodotti_aggiornati += 1;
        // The detail code is authoritative; cache rows are deduplicated per batch.
        const mapped = mapArticleToOrdersCache(article, { imageUrl });
        mappedByCode.set(mapped.codice_articolo, mapped);
      } catch (error) {
        result.errori.push({ codice: code || "senza codice", errore: error.message || String(error) });
      }
    }
    result.righe_mappate = mappedByCode.size;
    await assertRunStillRunning(supabase, syncRunId, "products");
    const cacheWrites = await upsertOrdersProductsCache(supabase, [...mappedByCode.values()]);
    result.inseriti = cacheWrites.inserted;
    result.aggiornati = cacheWrites.updated;
    result.righe_scritte = cacheWrites.inserted + cacheWrites.updated;

    const previousProcessed = Number(syncRun.processed || 0);
    const previousInserted = Number(syncRun.inserted || 0);
    const previousUpdated = Number(syncRun.updated || 0);
    const previousCache = syncRun.metadata?.cache_writes || {};
    const totals = {
      prodotti_inseriti: Number(previousCache.prodotti_inseriti || 0) + result.prodotti_inseriti,
      prodotti_aggiornati: Number(previousCache.prodotti_aggiornati || 0) + result.prodotti_aggiornati,
      cache_inseriti: Number(previousCache.cache_inseriti || 0) + result.inseriti,
      cache_aggiornati: Number(previousCache.cache_aggiornati || 0) + result.aggiornati,
    };
    const allBatchesCompleted = result.completato && previousProcessed + batch.length === result.totale;
    const totalProductWrites = previousInserted + previousUpdated + result.prodotti_inseriti + result.prodotti_aggiornati;
    const totalCacheWrites = totals.cache_inseriti + totals.cache_aggiornati;
    const noRowsDiagnostic = result.completato && result.totale > 0 && totalProductWrites + totalCacheWrites === 0;
    const status = result.completato ? (noRowsDiagnostic ? "failed" : "completed") : "running";
    const completionError = noRowsDiagnostic
      ? "Mexal ha restituito articoli validi ma non sono state scritte righe né in prodotti né in ordini_prodotti_cache."
      : result.errori.length ? "Alcuni articoli non sono stati sincronizzati." : null;
    await updateSyncRun(supabase, syncRunId, {
      status,
      completed_at: result.completato ? new Date().toISOString() : null,
      counters: {
        processed: batch.length,
        inserted: result.prodotti_inseriti,
        updated: result.prodotti_aggiornati,
        skipped: result.esclusi_non_attivi + result.esclusi_fuori_produzione,
        failed: result.errori.length,
      },
      error_message: completionError,
      metadata: {
        total: result.totale,
        last_offset: offset,
        images_saved: result.immagini_salvate,
        disattivati: result.disattivati,
        cache_writes: totals,
        diagnostics: result.diagnostics,
        detail_loaded: result.detail_loaded,
        mapped_rows: result.righe_mappate,
        written_rows: result.righe_scritte,
      },
    });
    return res.status(200).json({
      ...result,
      success: !noRowsDiagnostic && result.errori.length === 0,
      runId: Number(syncRunId),
      parsed: result.elaborati,
      detailLoaded: result.detail_loaded,
      inserted: result.inseriti,
      updated: result.aggiornati,
      prodottiInserted: result.prodotti_inseriti,
      prodottiUpdated: result.prodotti_aggiornati,
      totals,
      skipped: result.esclusi_non_attivi + result.esclusi_fuori_produzione,
      failed: result.errori.length,
      completed: result.completato,
      nextOffset: result.prossimo_offset,
    });
  } catch (error) {
    if (action === "sync-stock-it" && syncRunId) {
      const current = await getCentralSyncRun(supabase, syncRunId).catch(() => null);
      const state = stockRunState(current || {});
      const retryable = error?.retryable === true;
      const metadata = {
        ...(current?.metadata || {}),
        ...(error?.stockUpdateDiagnostics ? { stock_update_diagnostics: error.stockUpdateDiagnostics } : {}),
        recovery: {
          ...(current?.metadata?.recovery || {}),
          retryable,
          checkpoint_processed: state.processed,
          checkpoint_failed: state.failed,
          failed_at: new Date().toISOString(),
          last_error: String(error?.message || "Errore sincronizzazione giacenze.").slice(0, 500),
          attempts: Number(error?.retryAttempts || 1),
        },
      };
      await failSyncRunUnlessClosed(supabase, syncRunId, error?.message || "Errore sincronizzazione giacenze.", {
        processed: state.processed,
        updated: state.updated,
        skipped: state.skipped,
        failed: Math.max(1, state.failed),
        metadata,
      });
    }
    else {
      try {
        await updateSyncRun(supabase, syncRunId, {
          status: "failed", completed_at: new Date().toISOString(), error_message: error?.message || "Errore sincronizzazione prodotti.",
        });
      } catch (closeError) {
        if (!isSyncRunClosedError(closeError)) throw closeError;
      }
    }
    return res
      .status(Number(error?.status || 500))
      .json({
        error:
          error?.message ||
          "Errore interno API Mexal.",
      });
  }
}
