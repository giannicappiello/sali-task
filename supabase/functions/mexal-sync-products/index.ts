import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MODULE_CODE = "gestione_ordini";
const STORAGE_BUCKET = "prodotti-mexal";
const ARTICLE_PREFIXES = ["IT", "MKT", "IMP"];
const PAGE_SIZE = 500;

type MexalGroup = {
  codice?: string;
  descrizione?: string;
  cod_grp_merc?: string;
  id_cat_sconto?: number;
  nr_cat_sta?: number;
  cod_natura?: string | number;
};

type MexalArticle = Record<string, unknown> & {
  codice?: string;
  descrizione?: string;
  descrizione_agg?: string;
  descr_completa?: string;
  cod_alternativo?: string;
  alq_iva?: string;
  um_principale?: string;
  nr_cat_sta?: number;
  sigla_cat_sta?: string;
  cod_grp_merc?: string;
  id_cat_sconto?: number;
  nr_cat_sta?: number;
  cod_natura?: string | number;
  prz_listino?: Array<[number, number]>;
  qta_inventario?: number;
  qta_carico?: number;
  qta_scarico?: number;
  ord_fornitori?: number;
  ord_cli_e?: number;
  ord_cli_sps?: number;
  ord_cli_auto?: number;
  ord_produzione?: number;
  img_art_disp?: string;
  img_cat_disp?: string;
  img_icona_disp?: string;
  dt_mod_sistema?: string;
  data_ult_mod?: string;
  gest_annullato?: string;
  gest_precanc?: string;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ error: "Metodo non consentito" }, 405);
  }

  try {
    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader.startsWith("Bearer ")) {
      return json({ error: "Sessione mancante" }, 401);
    }

    const supabaseUrl = requireEnv("SUPABASE_URL");
    const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });

    const token = authHeader.slice(7);
    const { data: authData, error: authError } =
      await supabase.auth.getUser(token);

    if (authError || !authData.user) {
      return json({ error: "Sessione non valida" }, 401);
    }

    const { data: profile, error: profileError } = await supabase
      .from("utenti")
      .select("id,attivo,ruoli(nome,livello)")
      .eq("auth_user_id", authData.user.id)
      .maybeSingle();

    if (profileError || !profile || profile.attivo === false) {
      return json({ error: "Utente non configurato o disabilitato" }, 403);
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

    let isBackoffice = false;

    if (!isAdmin) {
      const { data: integration, error: integrationError } = await supabase
        .from("integrazioni_utenti")
        .select("enabled,ruolo_ordini")
        .eq("utente_id", profile.id)
        .eq("modulo", MODULE_CODE)
        .maybeSingle();

      if (integrationError) {
        return json(
          {
            error: "Errore verifica autorizzazione Gestione Ordini",
            details: integrationError.message,
          },
          500,
        );
      }

      isBackoffice =
        integration?.enabled === true &&
        integration?.ruolo_ordini === "backoffice";
    }

    if (!isAdmin && !isBackoffice) {
      return json(
        {
          error:
            "Sincronizzazione riservata ad amministratori e backoffice ordini",
        },
        403,
      );
    }

    const body = await safeJson(req);
    const dryRun = body?.dryRun === true;
    const downloadImages = body?.downloadImages !== false;
    const maxArticles = toPositiveInteger(body?.maxArticles);

    const mexal = createMexalClient();

    const groupsResponse = await mexal.get(
      "/dati-generali/gruppi-merceologici",
    );
    const groups = Array.isArray(groupsResponse?.dati)
      ? (groupsResponse.dati as MexalGroup[])
      : [];

    const groupMap = new Map(
      groups
        .filter((item) => item?.codice)
        .map((item) => [String(item.codice), item]),
    );

    const allArticles = await fetchAllArticles(mexal, maxArticles);
    const filteredArticles = allArticles.filter(isArticleForApp);

    if (!dryRun && downloadImages) {
      await ensurePublicBucket(supabase);
    }

    const codes = filteredArticles
      .map((article) => String(article.codice || "").trim())
      .filter(Boolean);

    const existingProducts = await loadExistingProducts(supabase, codes);
    const existingByCode = new Map<string, { id: string }>();

    for (const item of existingProducts) {
      if (item.codice_mexal) {
        existingByCode.set(String(item.codice_mexal).toUpperCase(), item);
      }
      if (item.codice) {
        existingByCode.set(String(item.codice).toUpperCase(), item);
      }
    }

    const result = {
      ambiente: {
        base_url: mexal.baseUrl,
        azienda: mexal.azienda,
        dominio: mexal.dominio || null,
        anno: mexal.anno,
        magazzino: mexal.magazzino || null,
      },
      letti_mexal: allArticles.length,
      selezionati: filteredArticles.length,
      inseriti: 0,
      aggiornati: 0,
      immagini_salvate: 0,
      errori: [] as Array<{ codice: string; errore: string }>,
      dry_run: dryRun,
    };

    for (const article of filteredArticles) {
      const code = String(article.codice || "").trim();

      try {
        const hierarchy = resolveHierarchy(
          String(article.cod_grp_merc || ""),
          groupMap,
        );

        let imageUrls = {
          immagine_url: null as string | null,
          immagine_catalogo_url: null as string | null,
          icona_url: null as string | null,
        };

        if (!dryRun && downloadImages) {
          imageUrls = await syncArticleImages(
            supabase,
            mexal,
            article,
            code,
          );

          result.immagini_salvate += Object.values(imageUrls).filter(
            Boolean,
          ).length;
        }

        const stock = calculateStock(article);
        const availability = calculateAvailability(article, stock);
        const listPrice = getListPrice(article.prz_listino, 1);
        const productName = buildProductName(article);
        const now = new Date().toISOString();

        const payload = {
          nome: productName || code,
          codice: code,
          codice_mexal: code,
          descrizione:
            String(article.descr_completa || "").trim() ||
            productName ||
            null,
          brand: hierarchy.brand?.descrizione || null,
          categoria:
            hierarchy.categoria?.descrizione ||
            hierarchy.linea?.descrizione ||
            null,
          sottocategoria: hierarchy.sottocategoria?.descrizione || null,
          brand_mexal: hierarchy.brand?.descrizione || null,
          linea_mexal: hierarchy.linea?.descrizione || null,
          categoria_mexal: hierarchy.categoria?.descrizione || null,
          sottocategoria_mexal:
            hierarchy.sottocategoria?.descrizione || null,
          ean: String(article.cod_alternativo || "").trim() || null,
          prezzo_listino: listPrice,
          categoria_sconto_articolo: Number(article.id_cat_sconto || 0),
          categoria_statistica_articolo: Number(article.nr_cat_sta || 0),
          gruppo_merceologico: String(article.cod_grp_merc || "").trim() || null,
          natura_articolo: String(article.cod_natura || "").trim() || null,
          dati_mexal: article,
          giacenza: stock,
          disponibilita: availability,
          immagine_url: imageUrls.immagine_url,
          immagine_catalogo_url: imageUrls.immagine_catalogo_url,
          icona_url: imageUrls.icona_url,
          mostra_in_app: true,
          sincronizzato_mexal: true,
          ultimo_sync_mexal: now,
          attivo:
            String(article.gest_annullato || "N") !== "S" &&
            String(article.gest_precanc || "N") !== "S",
          stato:
            String(article.gest_annullato || "N") === "S"
              ? "Non attivo"
              : "Attivo",
          updated_at: now,
        };

        const existing = existingByCode.get(code.toUpperCase());

        if (dryRun) {
          if (existing) result.aggiornati += 1;
          else result.inseriti += 1;
          continue;
        }

        if (existing?.id) {
          const { error } = await supabase
            .from("prodotti")
            .update(payload)
            .eq("id", existing.id);

          if (error) throw error;
          result.aggiornati += 1;
        } else {
          const { data, error } = await supabase
            .from("prodotti")
            .insert(payload)
            .select("id")
            .single();

          if (error) throw error;

          existingByCode.set(code.toUpperCase(), { id: data.id });
          result.inseriti += 1;
        }
      } catch (error) {
        result.errori.push({
          codice: code || "senza codice",
          errore: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return json(result);
  } catch (error) {
    return json(
      {
        error: error instanceof Error ? error.message : String(error),
      },
      500,
    );
  }
});

function createMexalClient() {
  const rawBaseUrl = requireEnv("MEXAL_BASE_URL").replace(/\/+$/, "");
  const username = requireEnv("MEXAL_USERNAME");
  const password = requireEnv("MEXAL_PASSWORD");
  const azienda = requireEnv("MEXAL_AZIENDA");
  const dominio = Deno.env.get("MEXAL_DOMINIO")?.trim() || "";
  const anno =
    Deno.env.get("MEXAL_ANNO")?.trim() ||
    String(new Date().getFullYear());
  const magazzino = Deno.env.get("MEXAL_MAGAZZINO")?.trim() || "";

  const baseUrl = rawBaseUrl.endsWith("/webapi/risorse")
    ? rawBaseUrl
    : `${rawBaseUrl}/webapi/risorse`;

  const credential = btoa(`${username}:${password}`);
  const authorization =
    `Passepartout ${credential}` +
    (dominio ? ` Dominio=${dominio}` : "");

  const coordinateCandidates = [
    `Azienda=${azienda} Anno=${anno}${
      magazzino ? ` Magazzino=${magazzino}` : ""
    }`,
    `Azienda=${azienda} Anno=${anno}`,
    `Azienda=${azienda}`,
  ];

  const insecureHttpClient = Deno.createHttpClient({
    unsafelyIgnoreCertificateErrors: [new URL(baseUrl).hostname],
  });

  async function request(
    path: string,
    init: RequestInit = {},
    binary = false,
  ): Promise<any> {
    let lastError = "";

    for (const coordinates of coordinateCandidates) {
      const response = await fetch(`${baseUrl}${path}`, {
        ...init,
        client: insecureHttpClient,
        headers: {
          Authorization: authorization,
          "Coordinate-Gestionale": coordinates,
          ...(init.headers || {}),
        },
      });

      if (response.ok) {
        if (binary) return response;
        const text = await response.text();
        return text ? JSON.parse(text) : {};
      }

      const errorText = await response.text();
      lastError =
        `Mexal ${response.status} ${response.statusText}: ${errorText}`;

      if (![400, 401].includes(response.status)) break;
    }

    throw new Error(lastError || "Errore chiamata Mexal");
  }

  return {
    baseUrl,
    azienda,
    dominio,
    anno,
    magazzino,
    get: (path: string) => request(path),
    getBinary: (path: string) => request(path, {}, true) as Promise<Response>,
  };
}

async function fetchAllArticles(
  mexal: ReturnType<typeof createMexalClient>,
  maxArticles: number | null,
) {
  const rows: MexalArticle[] = [];
  let next: string | null = null;
  let page = 0;

  do {
    const params = new URLSearchParams();
    params.set("max", String(PAGE_SIZE));
    if (next) params.set("next", next);

    const response = await mexal.get(`/articoli?${params.toString()}`);
    const data = Array.isArray(response?.dati)
      ? (response.dati as MexalArticle[])
      : [];

    rows.push(...data);
    next = response?.next ? String(response.next) : null;
    page += 1;

    if (maxArticles && rows.length >= maxArticles) {
      return rows.slice(0, maxArticles);
    }

    if (page > 500) {
      throw new Error("Interrotta paginazione articoli: troppe pagine");
    }
  } while (next);

  return rows;
}

function isArticleForApp(article: MexalArticle) {
  const code = String(article.codice || "").trim().toUpperCase();
  return ARTICLE_PREFIXES.some((prefix) => code.startsWith(prefix));
}

function resolveHierarchy(
  groupCode: string,
  groupMap: Map<string, MexalGroup>,
) {
  const chain: MexalGroup[] = [];
  const visited = new Set<string>();
  let currentCode = groupCode;

  while (currentCode && !visited.has(currentCode)) {
    visited.add(currentCode);
    const group = groupMap.get(currentCode);
    if (!group) break;

    chain.unshift(group);
    currentCode = String(group.cod_grp_merc || "").trim();
  }

  return {
    brand: chain[0] || null,
    linea: chain[1] || null,
    categoria: chain[2] || null,
    sottocategoria:
      chain.length >= 4 ? chain[chain.length - 1] : null,
    chain,
  };
}

async function syncArticleImages(
  supabase: ReturnType<typeof createClient>,
  mexal: ReturnType<typeof createMexalClient>,
  article: MexalArticle,
  code: string,
) {
  const result = {
    immagine_url: null as string | null,
    immagine_catalogo_url: null as string | null,
    icona_url: null as string | null,
  };

  const candidates = [
    {
      enabled: article.img_art_disp === "S",
      type: "immagine",
      field: "immagine_url" as const,
    },
    {
      enabled: article.img_cat_disp === "S",
      type: "immagine-catalogo",
      field: "immagine_catalogo_url" as const,
    },
    {
      enabled: article.img_icona_disp === "S",
      type: "icona",
      field: "icona_url" as const,
    },
  ];

  for (const candidate of candidates) {
    if (!candidate.enabled) continue;

    try {
      const response = await mexal.getBinary(
        `/articoli/${encodeURIComponent(code)}/allegati/${candidate.type}`,
      );

      const bytes = new Uint8Array(await response.arrayBuffer());
      const contentType =
        response.headers.get("content-type") || detectMimeType(bytes);
      const extension = extensionFromMime(contentType);
      const storagePath = `${sanitizePathPart(code)}/${candidate.type}.${extension}`;

      const { error: uploadError } = await supabase.storage
        .from(STORAGE_BUCKET)
        .upload(storagePath, bytes, {
          contentType,
          upsert: true,
          cacheControl: "3600",
        });

      if (uploadError) throw uploadError;

      const { data } = supabase.storage
        .from(STORAGE_BUCKET)
        .getPublicUrl(storagePath);

      result[candidate.field] = data.publicUrl;
    } catch (error) {
      console.error(
        `Errore immagine ${candidate.type} per ${code}:`,
        error,
      );
    }
  }

  return result;
}

async function ensurePublicBucket(
  supabase: ReturnType<typeof createClient>,
) {
  const { data: buckets, error: listError } =
    await supabase.storage.listBuckets();

  if (listError) throw listError;

  const existing = buckets?.find((bucket) => bucket.name === STORAGE_BUCKET);

  if (!existing) {
    const { error } = await supabase.storage.createBucket(STORAGE_BUCKET, {
      public: true,
      fileSizeLimit: 10 * 1024 * 1024,
      allowedMimeTypes: ["image/jpeg", "image/png", "image/webp"],
    });

    if (error) throw error;
    return;
  }

  if (!existing.public) {
    const { error } = await supabase.storage.updateBucket(STORAGE_BUCKET, {
      public: true,
      fileSizeLimit: 10 * 1024 * 1024,
      allowedMimeTypes: ["image/jpeg", "image/png", "image/webp"],
    });

    if (error) throw error;
  }
}

async function loadExistingProducts(
  supabase: ReturnType<typeof createClient>,
  codes: string[],
) {
  const rows: Array<{
    id: string;
    codice: string | null;
    codice_mexal: string | null;
  }> = [];

  for (let i = 0; i < codes.length; i += 200) {
    const chunk = codes.slice(i, i + 200);

    const [{ data: byMexal, error: mexalError }, { data: byCode, error: codeError }] =
      await Promise.all([
        supabase
          .from("prodotti")
          .select("id,codice,codice_mexal")
          .in("codice_mexal", chunk),
        supabase
          .from("prodotti")
          .select("id,codice,codice_mexal")
          .in("codice", chunk),
      ]);

    if (mexalError) throw mexalError;
    if (codeError) throw codeError;

    rows.push(...(byMexal || []), ...(byCode || []));
  }

  const unique = new Map<string, (typeof rows)[number]>();
  for (const row of rows) unique.set(row.id, row);
  return [...unique.values()];
}

function calculateStock(article: MexalArticle) {
  return round4(
    numberValue(article.qta_inventario) +
      numberValue(article.qta_carico) -
      numberValue(article.qta_scarico),
  );
}

function calculateAvailability(article: MexalArticle, stock: number) {
  return round4(
    stock +
      numberValue(article.ord_fornitori) +
      numberValue(article.ord_produzione) -
      numberValue(article.ord_cli_e) -
      numberValue(article.ord_cli_sps) -
      numberValue(article.ord_cli_auto),
  );
}

function getListPrice(
  prices: Array<[number, number]> | undefined,
  listId: number,
) {
  if (!Array.isArray(prices)) return null;

  const exact = prices.find(
    (item) => Array.isArray(item) && Number(item[0]) === listId,
  );

  if (exact) return numberValue(exact[1]);

  const first = prices.find((item) => Array.isArray(item));
  return first ? numberValue(first[1]) : null;
}

function buildProductName(article: MexalArticle) {
  const description = String(article.descrizione || "").trim();
  const additional = String(article.descrizione_agg || "").trim();
  return `${description}${additional ? ` ${additional}` : ""}`.trim();
}

function numberValue(value: unknown) {
  const result = Number(value || 0);
  return Number.isFinite(result) ? result : 0;
}

function round4(value: number) {
  return Math.round((value + Number.EPSILON) * 10000) / 10000;
}

function detectMimeType(bytes: Uint8Array) {
  if (
    bytes.length >= 4 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return "image/jpeg";
  }

  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return "image/png";
  }

  if (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
  ) {
    return "image/webp";
  }

  return "image/jpeg";
}

function extensionFromMime(mime: string) {
  if (mime.includes("png")) return "png";
  if (mime.includes("webp")) return "webp";
  return "jpg";
}

function sanitizePathPart(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function toPositiveInteger(value: unknown) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function requireEnv(name: string) {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`Secret mancante: ${name}`);
  return value;
}

async function safeJson(req: Request) {
  try {
    return await req.json();
  } catch {
    return {};
  }
}

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}
