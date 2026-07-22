import {
  createClient,
  SupabaseClient,
} from "https://esm.sh/@supabase/supabase-js@2.49.8";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type JsonRecord = Record<string, unknown>;

type SyncMode = "full" | "incremental";

interface RequestBody {
  mode?: SyncMode;
  syncPayments?: boolean;
  dryRun?: boolean;
}

interface EntityStats {
  read: number;
  written: number;
  deactivated: number;
  warnings: string[];
}

interface MexalClient {
  getAll(path: string): Promise<JsonRecord[]>;
  environment: {
    baseUrl: string;
    azienda: string;
    dominio: string | null;
    anno: string;
    magazzino: string | null;
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Metodo non consentito" }, 405);
  }

  const startedAt = Date.now();
  let runId: string | null = null;
  let supabase: SupabaseClient | null = null;

  try {
    const token = getBearerToken(req);
    const body = await readBody(req);
    const mode: SyncMode = body.mode === "incremental" ? "incremental" : "full";
    const dryRun = body.dryRun === true;
    const syncPayments = body.syncPayments !== false;

    supabase = createClient(
      requiredEnv("SUPABASE_URL"),
      requiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
      { auth: { persistSession: false, autoRefreshToken: false } },
    );

    const user = await requireAuthenticatedUser(supabase, token);
    await requireOrdersAdministrator(supabase, user.id);

    const run = await insertOne(supabase, "ordini_sync_runs", {
      sync_type: "commercial_conditions",
      source_system: "MEXAL",
      status: "running",
      requested_by: user.id,
      parameters: { mode, dryRun, syncPayments },
    });

    runId = String(run.id);

    const mexal = createMexalClient();

    const matrixStats: EntityStats = {
      read: 0,
      written: 0,
      deactivated: 0,
      warnings: [],
    };
    const particularityStats: EntityStats = {
      read: 0,
      written: 0,
      deactivated: 0,
      warnings: [],
    };
    const paymentStats: EntityStats = {
      read: 0,
      written: 0,
      deactivated: 0,
      warnings: [],
    };

    const matrixEndpoint =
      optionalEnv("MEXAL_DISCOUNT_MATRIX_ENDPOINT") ||
      "/dati-generali/sconti-listini";
    const particularitiesEndpoint =
      optionalEnv("MEXAL_PARTICULARITIES_ENDPOINT") ||
      "/dati-generali/particolarita";

    const [matrixItems, particularityItems] = await Promise.all([
      mexal.getAll(matrixEndpoint),
      mexal.getAll(particularitiesEndpoint),
    ]);

    matrixStats.read = matrixItems.length;
    particularityStats.read = particularityItems.length;

    const now = new Date().toISOString();

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
        last_seen_at: now,
      })),
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
          scaglione_2: item.scaglione_2,
        };

        return {
          chiave_regola: await sha256(stableStringify(ruleKeyPayload)),
          tipo_part: enumValue(item.tipo_part, ["P", "S", "V"], "S"),
          tp_dato_conto: enumValue(item.tp_dato_conto, ["C", "N", "S"], "C"),
          codice_conto: stringValue(item.codice_conto),
          id_cat_conto: integer(item.id_cat_conto),
          id_zona_conto: integer(item.id_zona_conto),
          id_catsta_conto: integer(item.id_catsta_conto),
          tp_dato_art: enumValue(
            item.tp_dato_art,
            ["A", "T", "M", "E", "U"],
            "A",
          ),
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
          last_seen_at: now,
        };
      }),
    );

    if (!dryRun) {
      matrixStats.written = await upsertInBatches(
        supabase,
        "ordini_sconti_listini",
        matrixRows,
        "cod_cat_cli,cod_cat_art",
      );

      particularityStats.written = await upsertInBatches(
        supabase,
        "ordini_particolarita",
        particularityRows,
        "chiave_regola",
      );

      if (mode === "full") {
        matrixStats.deactivated = await deactivateMissing(
          supabase,
          "ordini_sconti_listini",
          runId,
        );
        particularityStats.deactivated = await deactivateMissing(
          supabase,
          "ordini_particolarita",
          runId,
        );
      }
    }

    if (syncPayments) {
      const paymentEndpoint = optionalEnv("MEXAL_PAYMENT_DISCOUNT_ENDPOINT") || "/dati-generali/pagamenti";
      if (paymentEndpoint) {
        try {
          const paymentItems = await mexal.getAll(paymentEndpoint);
          paymentStats.read = paymentItems.length;

          const paymentRows = await Promise.all(
            paymentItems
              .map((item) => ({
                codice_pagamento: normalizePaymentCode(firstNonEmpty(
                  item.codice_pagamento,
                  item.codice,
                  item.id_pagamento,
                  item.id,
                  item.cod_pagamento,
                )),
                descrizione: firstNonEmpty(item.descrizione, item.descrizione_pagamento, item.descr, item.nome),
                sconto: paymentDiscount(item),
                sconto_esteso: paymentDiscount(item),
                data_inizio: parseMexalDate(item.data_inizio),
                data_fine: parseMexalDate(item.data_fine),
                priority: integer(item.priority) || 100,
                origine: "MEXAL",
                source_hash: "",
                dati_mexal: item,
                sync_run_id: runId,
                is_active: true,
                last_seen_at: now,
              }))
              .filter((row) => row.codice_pagamento),
          );

          for (const row of paymentRows) {
            row.source_hash = await sha256(stableStringify(row.dati_mexal));
          }

          if (!dryRun) {
            paymentStats.written = await upsertInBatches(
              supabase,
              "ordini_regole_pagamento",
              paymentRows,
              "codice_pagamento",
            );

            if (mode === "full") {
              paymentStats.deactivated = await deactivateMissing(
                supabase,
                "ordini_regole_pagamento",
                runId,
                "origine=eq.MEXAL",
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
            true,
          );
        }
      }
    }

    await Promise.all([
      writeDetail(supabase, runId, "discount_matrix", matrixStats),
      writeDetail(supabase, runId, "particularities", particularityStats),
      writeDetail(supabase, runId, "payment_rules", paymentStats),
    ]);

    const warnings = [
      ...matrixStats.warnings,
      ...particularityStats.warnings,
      ...paymentStats.warnings,
    ];

    const totals = {
      read: matrixStats.read + particularityStats.read + paymentStats.read,
      written:
        matrixStats.written + particularityStats.written + paymentStats.written,
      deactivated:
        matrixStats.deactivated +
        particularityStats.deactivated +
        paymentStats.deactivated,
    };

    const status =
      warnings.length > 0 ? "completed_with_warnings" : "completed";
    const durationMs = Date.now() - startedAt;

    await supabase
      .from("ordini_sync_runs")
      .update({
        status,
        completed_at: new Date().toISOString(),
        duration_ms: durationMs,
        records_read: totals.read,
        records_updated: totals.written,
        records_deactivated: totals.deactivated,
        warning_count: warnings.length,
        summary: {
          matrix: matrixStats,
          particularities: particularityStats,
          paymentRules: paymentStats,
          dryRun,
          environment: mexal.environment,
          endpoints: {
            discountMatrix: matrixEndpoint,
            particularities: particularitiesEndpoint,
            paymentRules:
              paymentEndpoint,
          },
        },
      })
      .eq("id", runId);

    return jsonResponse({
      ok: true,
      runId,
      status,
      durationMs,
      dryRun,
      matrix: matrixStats,
      particularities: particularityStats,
      paymentRules: paymentStats,
      environment: mexal.environment,
    });
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    const message = errorMessage(error);

    if (supabase && runId) {
      await logSyncError(
        supabase,
        runId,
        "commercial_conditions",
        null,
        error,
        false,
      );
      await supabase
        .from("ordini_sync_runs")
        .update({
          status: "failed",
          completed_at: new Date().toISOString(),
          duration_ms: durationMs,
          records_failed: 1,
          error_message: message,
        })
        .eq("id", runId);
    }

    const statusCode = error instanceof HttpError ? error.status : 500;
    return jsonResponse({ ok: false, runId, error: message }, statusCode);
  }
});

async function requireAuthenticatedUser(
  supabase: SupabaseClient,
  token: string,
) {
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) {
    throw new HttpError(401, "Sessione non valida");
  }
  return data.user;
}

async function requireOrdersAdministrator(
  supabase: SupabaseClient,
  userId: string,
) {
  const { data: profile, error: profileError } = await supabase
    .from("utenti")
    .select("id,attivo,ruolo_id,ruoli(nome,livello)")
    .eq("auth_user_id", userId)
    .maybeSingle();

  if (profileError) {
    throw new HttpError(
      500,
      `Errore verifica profilo applicativo: ${profileError.message}`,
    );
  }

  if (!profile || profile.attivo === false) {
    throw new HttpError(403, "Utente non configurato o disabilitato");
  }

  const role = profile.ruoli as JsonRecord | null;
  const roleName = stringValue(role?.nome).toLowerCase();
  const roleLevel = integer(role?.livello);
  const isAdmin =
    [
      "admin",
      "administrator",
      "amministratore",
      "super admin",
      "direzione",
    ].includes(roleName) || roleLevel >= 80;

  if (isAdmin) return;

  const { data: integration, error: integrationError } = await supabase
    .from("integrazioni_utenti")
    .select("enabled,ruolo_ordini")
    .eq("utente_id", profile.id)
    .eq("modulo", "gestione_ordini")
    .maybeSingle();

  if (integrationError) {
    throw new HttpError(
      500,
      `Errore verifica autorizzazione Gestione Ordini: ${integrationError.message}`,
    );
  }

  const isBackoffice =
    integration?.enabled === true &&
    stringValue(integration?.ruolo_ordini).toLowerCase() === "backoffice";

  if (isBackoffice) return;

  throw new HttpError(
    403,
    "Sincronizzazione riservata ad amministratori, Direzione e backoffice ordini",
  );
}

function createMexalClient(): MexalClient {
  const rawBaseUrl = requiredEnv("MEXAL_BASE_URL").replace(/\/+$/, "");
  const username = requiredEnv("MEXAL_USERNAME");
  const password = requiredEnv("MEXAL_PASSWORD");
  const azienda = requiredEnv("MEXAL_AZIENDA");
  const dominio = optionalEnv("MEXAL_DOMINIO");
  const anno = optionalEnv("MEXAL_ANNO") || String(new Date().getFullYear());
  const magazzino = optionalEnv("MEXAL_MAGAZZINO");

  const baseUrl = rawBaseUrl.endsWith("/webapi/risorse")
    ? rawBaseUrl
    : `${rawBaseUrl}/webapi/risorse`;

  const credential = btoa(`${username}:${password}`);
  const authorization =
    `Passepartout ${credential}` + (dominio ? ` Dominio=${dominio}` : "");

  const coordinateCandidates = [
    `Azienda=${azienda} Anno=${anno}${
      magazzino ? ` Magazzino=${magazzino}` : ""
    }`,
    `Azienda=${azienda} Anno=${anno}`,
    `Azienda=${azienda}`,
  ];

  const pageSize = Math.min(
    Math.max(integer(optionalEnv("MEXAL_PAGE_SIZE")) || 500, 50),
    1000,
  );
  const maxPages = Math.min(
    Math.max(integer(optionalEnv("MEXAL_MAX_PAGES")) || 100, 1),
    1000,
  );

  const insecureHttpClient = Deno.createHttpClient({
    unsafelyIgnoreCertificateErrors: [new URL(baseUrl).hostname],
  });

  async function request(path: string): Promise<JsonRecord> {
    let lastError = "";

    for (const coordinates of coordinateCandidates) {
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 60_000);

        try {
          const response = await fetch(`${baseUrl}${path}`, {
            client: insecureHttpClient,
            headers: {
              Authorization: authorization,
              "Coordinate-Gestionale": coordinates,
              Accept: "application/json",
            },
            signal: controller.signal,
          });

          const raw = await response.text();
          const parsed = parseJsonOrText(raw);

          if (response.ok) {
            return isRecord(parsed) ? parsed : { dati: parsed };
          }

          lastError = `Mexal ${response.status} ${path}: ${
            typeof parsed === "string" ? parsed : JSON.stringify(parsed)
          }`;

          const retryable = response.status === 429 || response.status >= 500;
          if (retryable && attempt < 3) {
            await sleep(750 * attempt);
            continue;
          }

          // Mexal può rifiutare alcune coordinate con 400/401. In quel caso
          // proviamo il candidato successivo, come già avviene nella funzione
          // mexal-sync-products del progetto.
          if ([400, 401].includes(response.status)) break;

          throw new Error(lastError);
        } catch (error) {
          lastError = errorMessage(error);
          if (attempt < 3) {
            await sleep(750 * attempt);
            continue;
          }
        } finally {
          clearTimeout(timeout);
        }
      }
    }

    throw new Error(lastError || `Errore chiamata Mexal ${path}`);
  }

  return {
    environment: {
      baseUrl,
      azienda,
      dominio: dominio || null,
      anno,
      magazzino: magazzino || null,
    },

    async getAll(path: string) {
      const all: JsonRecord[] = [];
      const seenHashes = new Set<string>();
      let next: string | null = null;

      for (let page = 1; page <= maxPages; page += 1) {
        const separator = path.includes("?") ? "&" : "?";
        const query = new URLSearchParams();
        query.set("max", String(pageSize));
        if (next) query.set("next", next);

        const body = await request(`${path}${separator}${query.toString()}`);
        const rows = extractRows(body);

        for (const row of rows) {
          const hash = stableStringify(row);
          if (!seenHashes.has(hash)) {
            seenHashes.add(hash);
            all.push(row);
          }
        }

        next = stringValue(body.next) || null;
        if (!next) break;
      }

      if (next) {
        throw new Error(
          `Paginazione Mexal interrotta per ${path}: superato MEXAL_MAX_PAGES`,
        );
      }

      return all;
    },
  };
}

async function upsertInBatches(
  supabase: SupabaseClient,
  table: string,
  rows: JsonRecord[],
  onConflict: string,
) {
  const batchSize = 500;
  let written = 0;

  for (let offset = 0; offset < rows.length; offset += batchSize) {
    const batch = rows.slice(offset, offset + batchSize);
    const { error } = await supabase
      .from(table)
      .upsert(batch, { onConflict, ignoreDuplicates: false });

    if (error) {
      throw new Error(`${table}: ${error.message}`);
    }

    written += batch.length;
  }

  return written;
}

async function deactivateMissing(
  supabase: SupabaseClient,
  table: string,
  runId: string,
  extraFilter?: string,
) {
  let query = supabase
    .from(table)
    .update({ is_active: false })
    .eq("is_active", true)
    .neq("sync_run_id", runId);

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

async function writeDetail(
  supabase: SupabaseClient,
  runId: string,
  entityType: string,
  stats: EntityStats,
) {
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
    metadata: { warnings: stats.warnings },
  });

  if (error) {
    console.error("Impossibile scrivere sync detail:", error.message);
  }
}

async function logSyncError(
  supabase: SupabaseClient,
  runId: string | null,
  entityType: string,
  sourceKey: string | null,
  error: unknown,
  retryable: boolean,
) {
  const { error: insertError } = await supabase
    .from("ordini_sync_errors")
    .insert({
      run_id: runId,
      entity_type: entityType,
      source_key: sourceKey,
      error_message: errorMessage(error),
      retryable,
    });

  if (insertError) {
    console.error("Impossibile registrare sync error:", insertError.message);
  }
}

async function insertOne(
  supabase: SupabaseClient,
  table: string,
  values: JsonRecord,
) {
  const { data, error } = await supabase
    .from(table)
    .insert(values)
    .select("*")
    .single();

  if (error) throw new Error(`${table}: ${error.message}`);
  return data as JsonRecord;
}

function extractRows(body: JsonRecord): JsonRecord[] {
  const candidates = [
    body.dati,
    body.data,
    body.risultati,
    body.results,
    body.items,
  ];

  for (const value of candidates) {
    if (Array.isArray(value)) {
      return value.filter(isRecord);
    }
  }

  return [];
}

function parseMexalDate(value: unknown): string | null {
  const raw = stringValue(value).replace(/\D/g, "").slice(0, 8);
  if (!raw || raw === "00000000") return null;
  if (!/^\d{8}$/.test(raw)) return null;

  const year = raw.slice(0, 4);
  const month = raw.slice(4, 6);
  const day = raw.slice(6, 8);
  const result = `${year}-${month}-${day}`;

  const date = new Date(`${result}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : result;
}

function getBearerToken(req: Request) {
  const header = req.headers.get("Authorization") ?? "";
  if (!header.startsWith("Bearer ")) {
    throw new HttpError(401, "Sessione mancante");
  }
  return header.slice(7);
}

async function readBody(req: Request): Promise<RequestBody> {
  const text = await req.text();
  if (!text.trim()) return {};

  try {
    return JSON.parse(text) as RequestBody;
  } catch {
    throw new HttpError(400, "Body JSON non valido");
  }
}

function requiredEnv(name: string) {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`Variabile ${name} mancante`);
  return value;
}

function optionalEnv(name: string) {
  return Deno.env.get(name)?.trim() ?? "";
}

function stringValue(value: unknown) {
  return String(value ?? "").trim();
}

function normalizePaymentCode(value: unknown): string {
  const code = stringValue(value);
  return /^0*\d+$/.test(code) ? String(Number(code)) : code;
}

function paymentDiscount(item: JsonRecord) {
  const fields = ["sconto_esteso", "sconto_pagamento", "perc_sconto_pagamento", "percentuale_sconto_pagamento", "perc_sconto", "percentuale_sconto", "sconto"];
  const visit = (value: unknown) => {
    if (!value || typeof value !== "object") return "";
    const record = value as JsonRecord;
    for (const field of fields) {
      const candidate = stringValue(record[field]);
      if (candidate && /[1-9]/.test(candidate.replace(/[^0-9]/g, ""))) return candidate;
    }
    for (const nested of Object.values(record)) {
      const candidate = visit(nested);
      if (candidate) return candidate;
    }
    return "";
  };
  return visit(item);
}

function firstNonEmpty(...values: unknown[]) {
  for (const value of values) {
    const result = stringValue(value);
    if (result) return result;
  }
  return "";
}

function integer(value: unknown) {
  const normalized = stringValue(value).replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : 0;
}

function arrayValue(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function enumValue(value: unknown, allowed: string[], fallback: string) {
  const normalized = stringValue(value).toUpperCase();
  return allowed.includes(normalized) ? normalized : fallback;
}

function parseJsonOrText(raw: string): unknown {
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }

  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
}

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function sleep(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

class HttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
