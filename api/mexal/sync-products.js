import https from "node:https";
import { createClient } from "@supabase/supabase-js";

const MODULE_CODE = "gestione_ordini";
const STORAGE_BUCKET = "prodotti-mexal";
const ARTICLE_PREFIXES = ["IT", "MKT", "IMP"];
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

function getArticleCode(article) {
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

  if (directCode) return directCode;

  if (article && typeof article === "object") {
    for (const value of Object.values(article)) {
      const candidate = normalizeCode(value);

      if (
        candidate &&
        ARTICLE_PREFIXES.some((prefix) =>
          candidate.startsWith(prefix)
        )
      ) {
        return candidate;
      }
    }
  }

  return "";
}

function numberValue(value) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function round4(value) {
  return Math.round((value + Number.EPSILON) * 10000) / 10000;
}

function requestMexal({ url, headers, binary = false }) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);

    const request = https.request(
      {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port || 443,
        path: `${parsed.pathname}${parsed.search}`,
        method: "GET",
        headers,
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
    throw new Error(
      parsed?.error?.["response-detail"] ||
        parsed?.error?.["response-message"] ||
        `${label}: HTTP ${response.status}`
    );
  }

  return parsed;
}

function buildMexalClient() {
  const baseUrl = requireEnv("MEXAL_BASE_URL").replace(/\/+$/, "");
  const username = requireEnv("MEXAL_USERNAME");
  const password = requireEnv("MEXAL_PASSWORD");
  const azienda = requireEnv("MEXAL_AZIENDA");
  const anno = requireEnv("MEXAL_ANNO");
  const magazzino = requireEnv("MEXAL_MAGAZZINO");

  const credential = Buffer.from(
    `${username}:${password}`,
    "utf8"
  ).toString("base64");

  const headers = {
    Authorization: `Passepartout ${credential}`,
    "Coordinate-Gestionale":
      `Azienda=${azienda} Anno=${anno} Magazzino=${magazzino}`,
    Accept: "application/json",
  };

  return {
    baseUrl,
    azienda,
    anno,
    magazzino,

    async getJson(path) {
      const response = await requestMexal({
        url: `${baseUrl}/webapi/risorse${path}`,
        headers,
      });

      return parseJsonResponse(response, path);
    },

    async getBinary(path) {
      const response = await requestMexal({
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

async function verifyUser(req, supabase, { allowOrdersUser = false } = {}) {
  const authorization = req.headers.authorization || "";
  const cronSecret = process.env.CRON_SECRET?.trim();

  if (cronSecret && authorization === `Bearer ${cronSecret}`) {
    return;
  }

  if (!authorization.startsWith("Bearer ")) {
    throw Object.assign(new Error("Sessione mancante."), {
      status: 401,
    });
  }

  const token = authorization.slice(7);

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser(token);

  if (authError || !user) {
    throw Object.assign(new Error("Sessione non valida."), {
      status: 401,
    });
  }

  const { data: profile, error: profileError } = await supabase
    .from("utenti")
    .select("id,attivo,ruoli(nome,livello)")
    .eq("auth_user_id", user.id)
    .maybeSingle();

  if (profileError || !profile || profile.attivo === false) {
    throw Object.assign(
      new Error("Utente non configurato o disabilitato."),
      { status: 403 }
    );
  }

  const roleName = String(profile.ruoli?.nome || "").toLowerCase();
  const roleLevel = Number(profile.ruoli?.livello || 0);

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
    .eq("modulo", MODULE_CODE)
    .maybeSingle();

  if (integrationError) {
    throw Object.assign(
      new Error("Errore verifica autorizzazione Gestione Ordini."),
      { status: 500 }
    );
  }

  const hasOrdersAccess = integration?.enabled === true;
  const isBackoffice =
    hasOrdersAccess && integration?.ruolo_ordini === "backoffice";

  if (allowOrdersUser && hasOrdersAccess) return;

  if (!isBackoffice) {
    throw Object.assign(
      new Error(
        "Operazione riservata ad amministratori e backoffice ordini."
      ),
      { status: 403 }
    );
  }
}

function isSupportedCode(code) {
  const normalized = normalizeCode(code);

  return ARTICLE_PREFIXES.some((prefix) =>
    normalized.startsWith(prefix)
  );
}

function isSupportedArticle(article) {
  return isSupportedCode(getArticleCode(article));
}

function isActiveArticle(article) {
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
    isSupportedArticle(article) &&
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

  return candidate ? numberValue(candidate[1]) : null;
}

function calculateStock(article) {
  return round4(
    numberValue(article?.qta_inventario) +
      numberValue(article?.qta_carico) -
      numberValue(article?.qta_scarico)
  );
}

function calculateAvailability(article, stock) {
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

function extractRows(response) {
  if (Array.isArray(response)) return response;
  if (Array.isArray(response?.dati)) return response.dati;
  if (Array.isArray(response?.records)) return response.records;
  if (Array.isArray(response?.items)) return response.items;
  return [];
}

async function getAllArticles(mexal) {
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
    const rows = extractRows(response);

    allRows.push(...rows);
    next = response?.next ? String(response.next) : null;
    page += 1;

    if (page > 200) {
      throw new Error("Paginazione articoli Mexal interrotta: troppe pagine.");
    }
  } while (next);

  /*
   * Il filtro IT*, MKT* e IMP* va applicato dopo aver letto tutte le pagine.
   * Lo stato attivo viene poi verificato nuovamente sul record completo durante
   * la sincronizzazione, così gli articoli annullati o precancellati non entrano.
   */
  return allRows
    .map((row) => ({
      row,
      code: getArticleCode(row),
    }))
    .filter(({ code }) => isSupportedCode(code))
    .sort((a, b) => a.code.localeCompare(b.code))
    .map(({ row }) => row);
}

async function getGroupMap(mexal) {
  const response = await mexal.getJson(
    "/dati-generali/gruppi-merceologici"
  );

  const groups = extractRows(response);

  return new Map(
    groups.map((group) => [
      String(group.codice || "").trim(),
      group,
    ])
  );
}

async function loadFullArticle(mexal, code, fallback) {
  const response = await mexal.getJson(
    `/articoli/${encodeURIComponent(code)}`
  );

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

async function createSyncRun(supabase, metadata) {
  const { data, error } = await supabase
    .from("mexal_sync_runs")
    .insert({ sync_type: "products", status: "running", metadata })
    .select("id,started_at,status,processed,failed,metadata")
    .single();
  if (error) throw error;
  return data;
}

async function getSyncRun(supabase, id) {
  const { data, error } = await supabase
    .from("mexal_sync_runs")
    .select("id,started_at,status,processed,failed,metadata")
    .eq("id", id)
    .eq("sync_type", "products")
    .maybeSingle();

  if (error) throw error;
  if (!data) {
    throw new Error("Run di sincronizzazione prodotti non trovata.");
  }

  return data;
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
  delete payload.counters;
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
  const { error } = await supabase
    .from("mexal_sync_runs")
    .update(payload)
    .eq("id", id)
    .eq("sync_type", "products");
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
    .or("codice_mexal.ilike.IT%,codice_mexal.ilike.MKT%,codice_mexal.ilike.IMP%")
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

    const action = body.action || "test";

    await verifyUser(req, supabase, {
      // Le sincronizzazioni automatiche possono essere avviate da qualunque
      // utente abilitato al modulo. Il lock centralizzato evita duplicazioni.
      allowOrdersUser: action === "sync-stock-it" || action === "sync",
    });

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
          origin: body.origin || "manual",
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
    }

    const mexal = buildMexalClient();

    const [articles, groupMap] =
      await Promise.all([
        getAllArticles(mexal),
        getGroupMap(mexal),
      ]);

    if (action === "test") {
      return res.status(200).json({
        ambiente: {
          base_url: mexal.baseUrl,
          azienda: mexal.azienda,
          anno: mexal.anno,
          magazzino: mexal.magazzino,
        },
        letti_mexal: articles.length,
        selezionati: articles.length,
        inseriti: 0,
        aggiornati: 0,
        immagini_salvate: 0,
        errori: [],
        dry_run: true,
        messaggio:
          "Connessione verificata. Trovati gli articoli con codice IT*, MKT* e IMP*. Lo stato attivo viene verificato sul record completo durante la sincronizzazione.",
      });
    }

    if (action === "sync-stock-it") {
      const itArticles = articles.filter((item) =>
        getArticleCode(item).startsWith("IT")
      );

      const batch = itArticles.slice(offset, offset + batchSize);
      const result = {
        totale: itArticles.length,
        elaborati: batch.length,
        offset,
        prossimo_offset: offset + batch.length,
        completato: offset + batch.length >= itArticles.length,
        aggiornati: 0,
        errori: [],
      };

      for (const summary of batch) {
        const code = getArticleCode(summary);

        try {
          const article = await loadFullArticle(mexal, code, summary);

          if (!isActiveArticle(article)) {
            continue;
          }

          const stock = calculateStock(article);
          const now = new Date().toISOString();

          const { error: updateError } = await supabase
            .from("prodotti")
            .update({
              giacenza: stock,
              disponibilita: calculateAvailability(article, stock),
              ultimo_sync_mexal: now,
              updated_at: now,
            })
            .eq("codice_mexal", code);

          if (updateError) throw updateError;
          result.aggiornati += 1;
        } catch (error) {
          result.errori.push({
            codice: code || "senza codice",
            errore: error?.message || String(error),
          });
        }
      }

      return res.status(200).json(result);
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
      immagini_salvate: 0,
      esclusi_non_attivi: 0,
      esclusi_fuori_produzione: 0,
      disattivati: 0,
      errori: [],
      sync_run_id: syncRunId,
    };

    for (const summary of batch) {
      const code = getArticleCode(summary);

      try {
        if (!code || !isSupportedCode(code)) {
          continue;
        }

        const article = await loadFullArticle(
          mexal,
          code,
          summary
        );

        if (!isActiveArticle(article)) {
          result.esclusi_non_attivi += 1;
          continue;
        }

        const hierarchy = resolveHierarchy(
          article.cod_grp_merc,
          groupMap
        );

        if (isOutOfProductionLine(hierarchy.linea?.descrizione)) {
          result.esclusi_fuori_produzione += 1;
          continue;
        }

        const existing =
          await findExistingProduct(
            supabase,
            code
          );

        let imageUrl =
          existing?.immagine_catalogo_url ||
          null;

        if (
          String(
            article?.img_cat_disp || "N"
          )
            .trim()
            .toUpperCase() === "S"
        ) {
          try {
            imageUrl =
              await syncCatalogImage({
                supabase,
                mexal,
                article,
                code,
              });

            if (imageUrl) {
              result.immagini_salvate += 1;
            }
          } catch (imageError) {
            result.errori.push({
              codice: code,
              errore:
                `Immagine catalogo: ${
                  imageError.message
                }`,
            });
          }
        }

        const operation = await saveProduct({
          supabase,
          article,
          hierarchy,
          imageUrl,
          existing,
        });

        if (operation === "inserted") {
          result.inseriti += 1;
        } else {
          result.aggiornati += 1;
        }
      } catch (error) {
        result.errori.push({
          codice: code || "senza codice",
          errore:
            error.message || String(error),
        });
      }
    }

    const previousProcessed = Number(syncRun.processed || 0);
    const previousFailures = Number(syncRun.failed || 0);
    const allBatchesCompleted =
      result.completato &&
      previousProcessed + batch.length === result.totale;
    const canReconcile =
      allBatchesCompleted &&
      previousFailures === 0 &&
      result.errori.length === 0;

    if (canReconcile) {
      result.disattivati = await reconcileStaleProducts(
        supabase,
        syncRun.started_at
      );
    }

    const status = result.completato
      ? (canReconcile ? "completed" : "completed_with_errors")
      : "running";
    const completionError = result.completato && !allBatchesCompleted
      ? "Lotti prodotti incompleti o non sequenziali: riconciliazione non eseguita."
      : result.errori.length || previousFailures
        ? "Alcuni articoli non sono stati sincronizzati: riconciliazione non eseguita."
        : null;
    await updateSyncRun(supabase, syncRunId, {
      status,
      completed_at: result.completato ? new Date().toISOString() : null,
      counters: {
        processed: batch.length,
        inserted: result.inseriti,
        updated: result.aggiornati,
        skipped: result.esclusi_non_attivi + result.esclusi_fuori_produzione,
        failed: result.errori.length,
      },
      error_message: completionError,
      metadata: {
        total: result.totale,
        last_offset: offset,
        images_saved: result.immagini_salvate,
        disattivati: result.disattivati,
      },
    });
    return res.status(200).json(result);
  } catch (error) {
    await updateSyncRun(supabase, syncRunId, {
      status: "failed",
      completed_at: new Date().toISOString(),
      error_message: error?.message || "Errore sincronizzazione prodotti.",
    });
    return res
      .status(Number(error?.status || 500))
      .json({
        error:
          error?.message ||
          "Errore interno API Mexal.",
      });
  }
}
