// @ts-check

const DEFAULT_TIMEOUT_MS = 10_000;
const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 30_000;
const MAX_PAGE = 100_000;
const MAX_PAGE_SIZE = 500;
const MAX_SEARCH_LENGTH = 200;
const MAX_STATUS_LENGTH = 64;

const COMMON_PAGED_PARAMETERS = ["page", "pageSize", "search"];

const RESOURCE_DEFINITIONS = Object.freeze({
  status: Object.freeze({
    path: "status",
    parameters: Object.freeze([]),
    fields: null,
  }),
  diagnostics: Object.freeze({
    path: "../v2/diagnostics",
    parameters: Object.freeze([]),
    fields: Object.freeze([
      "diagnosticId", "severity", "errorCode", "sourceSystem", "phase", "entityType", "entityId",
      "workspaceRdpV2Id", "workspaceCommercialOctId", "workspaceOctLineRevisionId", "ordineProduzioneId",
      "articleCode", "formulaCode", "stationCode", "fillingCode", "title", "description",
      "firstSeenAt", "lastSeenAt", "occurrenceCount", "status", "actionRequired", "correlationId",
      "retryable", "automaticRetryAttempted",
    ]),
    collection: true,
  }),
  "diagnostics-health": Object.freeze({
    path: "../v2/diagnostics/health",
    parameters: Object.freeze([]),
    fields: null,
    health: true,
  }),
  clients: Object.freeze({
    path: "clients",
    parameters: Object.freeze([...COMMON_PAGED_PARAMETERS, "active", "updatedAfter"]),
    fields: Object.freeze(["id", "codiceMexal", "ragioneSociale", "attivo"]),
  }),
  suppliers: Object.freeze({
    path: "suppliers",
    parameters: Object.freeze([...COMMON_PAGED_PARAMETERS, "active", "updatedAfter"]),
    fields: Object.freeze([
      "id", "codiceMexal", "ragioneSociale", "partitaIva", "codiceFiscale",
      "indirizzo", "cap", "localita", "provincia", "telefono", "email", "pec", "attivo",
    ]),
  }),
  articles: Object.freeze({
    path: "articles",
    parameters: Object.freeze([...COMMON_PAGED_PARAMETERS, "active", "updatedAfter"]),
    fields: Object.freeze([
      "id", "codice", "descrizione", "nomeCommerciale", "tipo", "categoria",
      "categoriaStatisticaMexal", "descrizioneCategoriaStatisticaMexal", "unitaMisura",
      "attivo", "gestioneLotti", "codiceBarre", "codiceMexal", "peso", "volume",
    ]),
  }),
  "production-orders": Object.freeze({
    path: "production-orders",
    parameters: Object.freeze([...COMMON_PAGED_PARAMETERS, "status", "from", "to"]),
    fields: Object.freeze([
      "id", "numeroOrdine", "articoloId", "codiceArticolo", "descrizioneArticolo",
      "nomeCliente", "quantita", "dataOrdine", "dataConsegna", "dataPrevistaConsegna",
      "priorita", "stato", "dataPianificataCorrente", "giorniRitardoPianificazione",
      "riferimentoOct", "riferimentoRdp",
    ]),
  }),
  "production-progress": Object.freeze({
    path: "production-progress",
    parameters: Object.freeze([...COMMON_PAGED_PARAMETERS, "status", "from", "to"]),
    fields: Object.freeze([
      "productionOrderId", "orderNumber", "phase", "status", "start", "end",
      "plannedQuantity", "producedQuantity", "progressPercent",
    ]),
  }),
  inventory: Object.freeze({
    path: "inventory",
    parameters: Object.freeze([...COMMON_PAGED_PARAMETERS, "status", "updatedAfter"]),
    fields: Object.freeze([
      "articoloId", "codiceArticolo", "descrizioneArticolo", "numeroMagazzino",
      "quantita", "quantitaImpegnata", "quantitaDisponibile", "stato", "dataAggiornamento",
    ]),
  }),
  planning: Object.freeze({
    path: "planning",
    parameters: Object.freeze([...COMMON_PAGED_PARAMETERS, "status", "from", "to"]),
    fields: Object.freeze([
      "productionOrderId", "orderNumber", "articleCode", "articleDescription",
      "operationType", "start", "end", "status",
    ]),
  }),
});

export class ProgremesClientError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {{ status?: number, upstreamStatus?: number, cause?: unknown }} [options]
   */
  constructor(code, message, options = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "ProgremesClientError";
    this.code = code;
    this.status = options.status ?? 502;
    this.upstreamStatus = options.upstreamStatus ?? null;
  }
}

/**
 * Carica l'intera anagrafica fornitori, non soltanto la prima pagina.
 * La risoluzione dei PF usa gli ID MES e deve quindi poter trovare anche
 * fornitori oltre il limite massimo di 500 righe per richiesta.
 *
 * @param {{ request: (resource: string, query: Record<string, unknown>) => Promise<{ items?: unknown[], total?: number, pageSize?: number }> }} client
 * @param {{ active?: boolean, pageSize?: number, maxPages?: number }} [options]
 */
export async function readAllProgremesSuppliers(client, options = {}) {
  const active = options.active ?? true;
  const pageSize = options.pageSize ?? MAX_PAGE_SIZE;
  const maxPages = options.maxPages ?? 1_000;
  const first = await client.request("suppliers", { page: 1, pageSize, active });
  const items = [...(first?.items || [])];
  const total = Number(first?.total ?? items.length);
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (!Number.isSafeInteger(pages) || pages > maxPages) {
    throw new ProgremesClientError("INVALID_RESPONSE", "Numero pagine fornitori ProgreMES non valido.", { status: 502 });
  }
  for (let page = 2; page <= pages; page += 1) {
    const result = await client.request("suppliers", { page, pageSize, active });
    items.push(...(result?.items || []));
  }
  return items;
}

/**
 * Carica l'intera anagrafica articoli per risolvere in modo automatico le
 * associazioni storiche articolo-fornitore lette da Mexal.
 *
 * @param {{ request: (resource: string, query: Record<string, unknown>) => Promise<{ items?: unknown[], total?: number, pageSize?: number }> }} client
 * @param {{ active?: boolean, pageSize?: number, maxPages?: number }} [options]
 */
export async function readAllProgremesArticles(client, options = {}) {
  const active = options.active ?? true;
  const pageSize = options.pageSize ?? MAX_PAGE_SIZE;
  const maxPages = options.maxPages ?? 1_000;
  const first = await client.request("articles", { page: 1, pageSize, active });
  const items = [...(first?.items || [])];
  const total = Number(first?.total ?? items.length);
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (!Number.isSafeInteger(pages) || pages > maxPages) {
    throw new ProgremesClientError("INVALID_RESPONSE", "Numero pagine articoli ProgreMES non valido.", { status: 502 });
  }
  for (let page = 2; page <= pages; page += 1) {
    const result = await client.request("articles", { page, pageSize, active });
    items.push(...(result?.items || []));
  }
  return items;
}

/** @param {unknown} value */
function singleValue(value) {
  if (value === undefined || value === null || value === "") return null;
  if (Array.isArray(value)) {
    throw new ProgremesClientError("INVALID_QUERY", "Un parametro non puo essere ripetuto.", { status: 400 });
  }
  return String(value).trim();
}

/** @param {string} name @param {string} value @param {number} maximum */
function positiveInteger(name, value, maximum) {
  if (!/^\d+$/.test(value)) {
    throw new ProgremesClientError("INVALID_QUERY", `Il parametro ${name} deve essere un intero positivo.`, { status: 400 });
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw new ProgremesClientError("INVALID_QUERY", `Il parametro ${name} non rientra nei limiti consentiti.`, { status: 400 });
  }
  return String(parsed);
}

/** @param {string} name @param {string} value */
function isoDate(name, value) {
  if (!Number.isFinite(Date.parse(value))) {
    throw new ProgremesClientError("INVALID_QUERY", `Il parametro ${name} non contiene una data valida.`, { status: 400 });
  }
  return value;
}

/**
 * @param {keyof typeof RESOURCE_DEFINITIONS} resource
 * @param {Record<string, unknown>} rawQuery
 */
export function validateProgremesQuery(resource, rawQuery = {}) {
  const definition = RESOURCE_DEFINITIONS[resource];
  if (!definition) {
    throw new ProgremesClientError("RESOURCE_NOT_ALLOWED", "Risorsa ProgreMES non consentita.", { status: 404 });
  }

  const allowed = new Set(["route", "resource", ...definition.parameters]);
  for (const key of Object.keys(rawQuery)) {
    if (!allowed.has(key)) {
      throw new ProgremesClientError("INVALID_QUERY", `Parametro non consentito: ${key}.`, { status: 400 });
    }
  }

  const query = new URLSearchParams();
  for (const name of definition.parameters) {
    const value = singleValue(rawQuery[name]);
    if (value === null) continue;

    if (name === "page") query.set(name, positiveInteger(name, value, MAX_PAGE));
    else if (name === "pageSize") query.set(name, positiveInteger(name, value, MAX_PAGE_SIZE));
    else if (name === "active") {
      if (!/^(true|false)$/i.test(value)) {
        throw new ProgremesClientError("INVALID_QUERY", "Il parametro active deve essere true oppure false.", { status: 400 });
      }
      query.set(name, value.toLowerCase());
    } else if (["from", "to", "updatedAfter"].includes(name)) query.set(name, isoDate(name, value));
    else if (name === "search") {
      if (value.length > MAX_SEARCH_LENGTH) {
        throw new ProgremesClientError("INVALID_QUERY", "Il parametro search supera la lunghezza consentita.", { status: 400 });
      }
      if (value) query.set(name, value);
    } else if (name === "status") {
      if (!value || value.length > MAX_STATUS_LENGTH || !/^[\p{L}\p{N}_ -]+$/u.test(value)) {
        throw new ProgremesClientError("INVALID_QUERY", "Il parametro status non e valido.", { status: 400 });
      }
      query.set(name, value);
    }
  }

  const from = query.get("from");
  const to = query.get("to");
  if (from && to && Date.parse(from) > Date.parse(to)) {
    throw new ProgremesClientError("INVALID_QUERY", "Il parametro from non puo essere successivo a to.", { status: 400 });
  }
  return query;
}

/** @param {string} baseUrl */
function normalizeBaseUrl(baseUrl) {
  let parsed;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new ProgremesClientError("INVALID_CONFIGURATION", "PROGREMES_URL non e valido.", { status: 500 });
  }
  const loopback = ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname);
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && loopback)) {
    throw new ProgremesClientError("INVALID_CONFIGURATION", "ProgreMES richiede HTTPS, salvo loopback locale.", { status: 500 });
  }
  parsed.hash = "";
  parsed.search = "";
  parsed.pathname = `${parsed.pathname.replace(/\/+$/, "")}/`;
  return parsed;
}

/**
 * @param {keyof typeof RESOURCE_DEFINITIONS} resource
 * @param {Record<string, unknown>} query
 * @param {string} baseUrl
 */
export function buildProgremesUrl(resource, query, baseUrl) {
  const definition = RESOURCE_DEFINITIONS[resource];
  if (!definition) {
    throw new ProgremesClientError("RESOURCE_NOT_ALLOWED", "Risorsa ProgreMES non consentita.", { status: 404 });
  }
  const url = new URL(definition.path, normalizeBaseUrl(baseUrl));
  url.search = validateProgremesQuery(resource, query).toString();
  return url;
}

/** @param {unknown} payload */
function sanitizeStatus(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const value = /** @type {Record<string, unknown>} */ (payload);
  const modules = value.modules;
  if (value.readOnly !== true || !modules || typeof modules !== "object" || Array.isArray(modules)) return null;
  const moduleValue = /** @type {Record<string, unknown>} */ (modules);
  const moduleKeys = ["clients", "suppliers", "articles", "orders", "productionSummary", "inventory", "planning"];
  if (moduleKeys.some((key) => typeof moduleValue[key] !== "boolean")) return null;
  const source = typeof value.source === "string" ? value.source.trim() : "";
  const apiVersion = typeof value.apiVersion === "number" ? value.apiVersion : Number.NaN;
  const generatedAt = typeof value.generatedAt === "string" ? value.generatedAt : "";
  if (!source || !Number.isInteger(apiVersion) || apiVersion < 1 || !Number.isFinite(Date.parse(generatedAt))) return null;
  return {
    source,
    apiVersion,
    readOnly: true,
    generatedAt,
    modules: Object.fromEntries(moduleKeys.map((key) => [key, moduleValue[key]])),
  };
}

/**
 * @param {unknown} payload
 * @param {readonly string[]} fields
 */
function sanitizePaged(payload, fields) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const value = /** @type {Record<string, unknown>} */ (payload);
  if (![value.page, value.pageSize, value.total].every(Number.isInteger) || !Array.isArray(value.items)) return null;
  if (
    Number(value.page) < 1 ||
    Number(value.pageSize) < 1 ||
    Number(value.pageSize) > 500 ||
    Number(value.total) < 0
  ) return null;
  const items = [];
  for (const item of value.items) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const row = /** @type {Record<string, unknown>} */ (item);
    if (fields.some((field) => !(field in row))) return null;
    items.push(Object.fromEntries(fields.map((field) => [field, row[field]])));
  }
  return { page: value.page, pageSize: value.pageSize, total: value.total, items };
}

function sanitizeCollection(payload, fields) {
  if (!Array.isArray(payload)) return null;
  return payload.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new ProgremesClientError("INVALID_RESPONSE", "Riga diagnostica ProgreMES non valida.", { status: 502 });
    const row = /** @type {Record<string, unknown>} */ (item);
    if (fields.some((field) => !(field in row))) throw new ProgremesClientError("INVALID_RESPONSE", "Contratto diagnostico ProgreMES incompleto.", { status: 502 });
    return Object.fromEntries(fields.map((field) => [field, row[field]]));
  });
}

function sanitizeHealth(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const value = /** @type {Record<string, unknown>} */ (payload);
  const fields = ["globalStatus", "open", "info", "warning", "blocking", "critical", "generatedAt", "database", "workspaceCallbacks", "pendingOutbox", "lastMexalSuccess", "lastMexalError", "receiveRdp", "receiveDecisions", "executeProduction", "createLots"];
  if (fields.some((field) => !(field in value))) return null;
  return { ...Object.fromEntries(fields.map((field) => [field, value[field]])),
    receiveV4Previews: value.receiveV4Previews === true,
    confirmV4Production: value.confirmV4Production === true };
}

/**
 * @param {keyof typeof RESOURCE_DEFINITIONS} resource
 * @param {unknown} payload
 */
function sanitizeResponse(resource, payload) {
  const definition = RESOURCE_DEFINITIONS[resource];
  if (definition.health) return sanitizeHealth(payload);
  if (definition.collection) return sanitizeCollection(payload, definition.fields);
  return definition.fields === null ? sanitizeStatus(payload) : sanitizePaged(payload, definition.fields);
}

/**
 * @param {{
 *   progremesUrl?: string,
 *   baseUrl?: string,
 *   secret?: string,
 *   timeoutMs?: number,
 *   fetchFn?: typeof fetch,
 *   logger?: Pick<Console, "error">
 * }} [options]
 */
export function createProgremesClient(options = {}) {
  const progremesUrl = String(options.progremesUrl ?? globalThis.process.env.PROGREMES_URL ?? "").trim();
  const derivedBaseUrl = progremesUrl ? `${progremesUrl.replace(/\/+$/, "")}/api/workspace/v1/` : "";
  const baseUrl = String(options.baseUrl ?? derivedBaseUrl).trim();
  const secret = String(options.secret ?? globalThis.process.env.PROGREMES_INTEGRATION_SECRET ?? "").trim();
  if (!baseUrl) {
    throw new ProgremesClientError("MISSING_CONFIGURATION", "PROGREMES_URL non configurato.", { status: 500 });
  }
  if (!secret) {
    throw new ProgremesClientError("MISSING_CONFIGURATION", "PROGREMES_INTEGRATION_SECRET non configurato.", { status: 500 });
  }

  const configuredTimeout = Number(options.timeoutMs ?? globalThis.process.env.PROGREMES_API_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);
  const timeoutMs = Number.isFinite(configuredTimeout)
    ? Math.min(MAX_TIMEOUT_MS, Math.max(MIN_TIMEOUT_MS, Math.trunc(configuredTimeout)))
    : DEFAULT_TIMEOUT_MS;
  const fetchFn = options.fetchFn ?? globalThis.fetch;
  const logger = options.logger ?? console;

  return Object.freeze({
    /**
     * @param {keyof typeof RESOURCE_DEFINITIONS} resource
     * @param {Record<string, unknown>} [query]
     */
    async request(resource, query = {}) {
      const url = buildProgremesUrl(resource, query, baseUrl);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchFn(url, {
          method: "GET",
          headers: { Accept: "application/json", "X-Workspace-Secret": secret },
          signal: controller.signal,
          redirect: "error",
        });
        if (!response.ok) {
          throw new ProgremesClientError(
            "UPSTREAM_HTTP_ERROR",
            "ProgreMES ha rifiutato la richiesta read-only.",
            { status: 502, upstreamStatus: response.status },
          );
        }

        let payload;
        try {
          payload = JSON.parse(await response.text());
        } catch (error) {
          throw new ProgremesClientError("INVALID_RESPONSE", "Risposta ProgreMES non valida.", { status: 502, cause: error });
        }
        const sanitized = sanitizeResponse(resource, payload);
        if (!sanitized) {
          throw new ProgremesClientError("INVALID_RESPONSE", "Contratto risposta ProgreMES non valido.", { status: 502 });
        }
        return sanitized;
      } catch (error) {
        if (error instanceof ProgremesClientError) {
          logger.error("ProgreMES read-only request failed", { resource, code: error.code, upstreamStatus: error.upstreamStatus });
          throw error;
        }
        const timedOut = controller.signal.aborted || (error instanceof Error && error.name === "AbortError");
        const wrapped = new ProgremesClientError(
          timedOut ? "TIMEOUT" : "UNREACHABLE",
          timedOut ? "Timeout durante la richiesta a ProgreMES." : "ProgreMES non raggiungibile.",
          { status: timedOut ? 504 : 502, cause: error },
        );
        logger.error("ProgreMES read-only request failed", { resource, code: wrapped.code });
        throw wrapped;
      } finally {
        clearTimeout(timeout);
      }
    },
  });
}

export const PROGREMES_ALLOWED_RESOURCES = Object.freeze(Object.keys(RESOURCE_DEFINITIONS));
