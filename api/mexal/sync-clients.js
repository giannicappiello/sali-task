import https from "node:https";
import { createClient } from "@supabase/supabase-js";

const MODULE_CODE = "gestione_ordini";
const CLIENT_PREFIX = "501";
const PAGE_SIZE = 500;
const UPSERT_BATCH_SIZE = 100;

function requireEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Variabile Vercel mancante: ${name}`);
  return value;
}

function normalize(value) {
  return String(value ?? "").trim();
}

function upper(value) {
  return normalize(value).toUpperCase();
}

function firstValue(object, keys, fallback = null) {
  for (const key of keys) {
    const value = object?.[key];
    if (value !== undefined && value !== null && normalize(value) !== "") {
      return value;
    }
  }
  return fallback;
}

function nullableInteger(value) {
  const text = normalize(value);
  if (!text) return null;

  const parsed = Number.parseInt(text, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function nullableNumber(value) {
  const text = normalize(value).replace(",", ".");
  if (!text) return null;

  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function requestMexal({ url, headers }) {
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
        timeout: 60000,
      },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => {
          resolve({
            status: response.statusCode || 500,
            body: Buffer.concat(chunks).toString("utf8"),
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

function parseMexalResponse(response, label) {
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

function extractRows(response) {
  if (Array.isArray(response)) return response;

  const candidates = [
    response?.dati,
    response?.records,
    response?.items,
    response?.clienti,
    response?.data,
    response?.results,
    response?.risultati,
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
  }

  return [];
}

function getClientCode(client) {
  const direct = firstValue(client, [
    "codice",
    "codice_cliente",
    "cod_conto",
    "codconto",
    "conto",
    "codiceConto",
  ]);

  if (direct) return upper(direct);

  if (client && typeof client === "object") {
    for (const value of Object.values(client)) {
      const candidate = upper(value);
      if (candidate.startsWith(CLIENT_PREFIX)) return candidate;
    }
  }

  return "";
}

function isMetadataResponse(rows) {
  if (!rows.length) return false;

  const first = rows[0];
  if (!first || typeof first !== "object" || Array.isArray(first)) return false;

  return (
    typeof first.nome === "string" &&
    typeof first.descrizione === "string" &&
    ("tipo" in first || "dimensione" in first || "obbligatorio" in first) &&
    !getClientCode(first)
  );
}

function getNextToken(response) {
  const value = firstValue(response, [
    "next",
    "next_token",
    "nextToken",
    "prossimo",
    "continuation_token",
  ]);

  return value === null || value === undefined || normalize(value) === ""
    ? null
    : String(value);
}

function buildMexalClient() {
  const baseUrl = requireEnv("MEXAL_BASE_URL").replace(/\/+$/, "");
  const username = requireEnv("MEXAL_USERNAME");
  const password = requireEnv("MEXAL_PASSWORD");
  const azienda = requireEnv("MEXAL_AZIENDA");
  const anno = requireEnv("MEXAL_ANNO");
  const magazzino = requireEnv("MEXAL_MAGAZZINO");

  const credential = Buffer.from(`${username}:${password}`, "utf8").toString(
    "base64"
  );

  const headers = {
    Authorization: `Passepartout ${credential}`,
    "Coordinate-Gestionale": `Azienda=${azienda} Anno=${anno} Magazzino=${magazzino}`,
    Accept: "application/json",
  };

  return {
    async get(path) {
      const response = await requestMexal({
        url: `${baseUrl}/webapi/risorse${path}`,
        headers,
      });
      return parseMexalResponse(response, path);
    },
  };
}

async function verifyUser(req, supabase) {
  const authorization = req.headers.authorization || "";
  if (!authorization.startsWith("Bearer ")) {
    throw Object.assign(new Error("Sessione mancante."), { status: 401 });
  }

  const token = authorization.slice(7);
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser(token);

  if (authError || !user) {
    throw Object.assign(new Error("Sessione non valida."), { status: 401 });
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

  const roleName = upper(profile.ruoli?.nome);
  const roleLevel = Number(profile.ruoli?.livello || 0);
  const isAdmin =
    [
      "ADMIN",
      "ADMINISTRATOR",
      "AMMINISTRATORE",
      "SUPER ADMIN",
      "DIREZIONE",
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

  if (
    integration?.enabled !== true ||
    integration?.ruolo_ordini !== "backoffice"
  ) {
    throw Object.assign(
      new Error("Sincronizzazione clienti riservata ad ADMIN e Backoffice."),
      { status: 403 }
    );
  }
}

function getAgentCode(client) {
  const raw = firstValue(client, [
    "codice_agente",
    "cod_agente",
    "agente",
    "codagente",
    "agente_1",
    "codice_agente_1",
  ]);

  if (Array.isArray(raw)) return upper(raw[0]);
  if (raw && typeof raw === "object") {
    return upper(firstValue(raw, ["codice", "codice_agente", "id"]));
  }
  return upper(raw);
}


function getPaymentCode(payment) {
  return nullableInteger(
    firstValue(payment, [
      "codice",
      "codice_pagamento",
      "cod_pagamento",
      "pagamento",
      "id",
    ])
  );
}

function getPaymentDescription(payment) {
  return (
    normalize(
      firstValue(payment, [
        "descrizione",
        "descrizione_pagamento",
        "des_pagamento",
        "denominazione",
        "nome",
      ])
    ) || null
  );
}

async function loadPaymentsMap(mexal) {
  try {
    const response = await mexal.get("/dati-generali/pagamenti");
    const rows = extractRows(response);
    const result = new Map();

    for (const row of rows) {
      const code = getPaymentCode(row);
      const description = getPaymentDescription(row);
      if (code !== null && description) result.set(String(code), description);
    }

    return result;
  } catch (error) {
    console.error("Impossibile caricare le descrizioni dei pagamenti Mexal:", error);
    return new Map();
  }
}

function mapClient(client, syncDate, paymentsMap) {
  const code = getClientCode(client);
  const companyName = normalize(
    firstValue(client, [
      "ragione_sociale",
      "descrizione",
      "denominazione",
      "nome",
      "intestazione",
      "rag_soc",
    ])
  );

  const cancellationFlag = upper(
    firstValue(client, ["gest_annullato", "annullato", "precancellato"], "N")
  );

  const paymentCode = nullableInteger(
    firstValue(client, [
      "codice_pagamento",
      "pagamento",
      "cod_pagamento",
      "condizione_pagamento",
    ])
  );

  const enrichedMexalData = {
    ...client,
    _descrizione_pagamento:
      paymentsMap?.get(String(paymentCode)) ||
      normalize(
        firstValue(client, [
          "descrizione_pagamento",
          "des_pagamento",
          "pagamento_descrizione",
        ])
      ) ||
      null,
  };

  return {
    codice_cliente: code,
    ragione_sociale: companyName || code,
    partita_iva:
      normalize(firstValue(client, ["partita_iva", "piva", "p_iva", "vat_number"])) ||
      null,
    codice_fiscale:
      normalize(firstValue(client, ["codice_fiscale", "cod_fiscale", "cf"])) ||
      null,
    indirizzo:
      normalize(firstValue(client, ["indirizzo", "via", "indirizzo_sede", "indirizzo1"])) ||
      null,
    cap: normalize(firstValue(client, ["cap", "codice_postale"])) || null,
    localita:
      normalize(firstValue(client, ["localita", "citta", "comune", "località"])) ||
      null,
    provincia:
      upper(firstValue(client, ["provincia", "prov", "sigla_provincia"])) ||
      null,
    telefono:
      normalize(firstValue(client, ["telefono", "tel", "telefono1"])) || null,
    email:
      normalize(firstValue(client, ["email", "mail", "posta_elettronica"])) ||
      null,
    codice_pagamento: paymentCode,
    codice_listino: nullableInteger(
      firstValue(client, ["codice_listino", "listino", "cod_listino", "nr_listino"])
    ),
    categoria_sconti: nullableInteger(
      firstValue(client, [
        "categoria_sconti",
        "cod_cat_sconti",
        "codice_categoria_sconti",
        "cat_sconti",
      ])
    ),
    sconto_incondizionato:
      normalize(
        firstValue(client, [
          "sconto_incondizionato",
          "sconto_incond",
          "sconto_cliente",
          "sconto",
        ])
      ) || null,
    codice_agente_mexal: getAgentCode(client) || null,
    codice_indirizzo_spedizione:
      normalize(
        firstValue(client, [
          "codice_indirizzo_spedizione",
          "cod_ind_sped",
          "cod_indirizzo_spedizione",
          "indirizzo_spedizione",
        ])
      ) || null,
    fido:
      nullableNumber(firstValue(client, ["fido", "importo_fido", "affidamento"])) ||
      0,
    insoluti:
      nullableNumber(firstValue(client, ["insoluti", "importo_insoluti"])) || 0,
    dati_mexal: enrichedMexalData,
    sincronizzato_il: syncDate,
    attivo_mexal: !["S", "Y", "TRUE", "1"].includes(cancellationFlag),
    sincronizzato_mexal: true,
    ultimo_sync_mexal: syncDate,
    json_mexal: enrichedMexalData,
  };
}

async function loadAllClients(mexal, paymentsMap) {
  const rawRows = [];
  let next = null;
  let page = 0;

  do {
    const params = new URLSearchParams();
    params.set("max", String(PAGE_SIZE));
    if (next) params.set("next", next);

    const query = params.toString();
    const response = await mexal.get(`/clienti${query ? `?${query}` : ""}`);
    const pageRows = extractRows(response);

    if (isMetadataResponse(pageRows)) {
      throw new Error(
        "Mexal ha restituito i metadati dell'endpoint clienti invece delle anagrafiche. Verificare che la richiesta non contenga info=true."
      );
    }

    rawRows.push(...pageRows);
    next = getNextToken(response);
    page += 1;

    if (page > 200) {
      throw new Error("Paginazione clienti Mexal interrotta: troppe pagine.");
    }
  } while (next);

  const syncDate = new Date().toISOString();
  const unique = new Map();

  for (const rawClient of rawRows) {
    const mapped = mapClient(rawClient, syncDate, paymentsMap);
    if (!mapped.codice_cliente.startsWith(CLIENT_PREFIX)) continue;
    unique.set(mapped.codice_cliente, mapped);
  }

  return [...unique.values()];
}

function formatSupabaseError(error) {
  return {
    message: error?.message || "Errore Supabase sconosciuto",
    code: error?.code || null,
    details: error?.details || null,
    hint: error?.hint || null,
  };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Metodo non consentito." });
  }

  try {
    const supabase = createClient(
      requireEnv("SUPABASE_URL"),
      requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
      { auth: { persistSession: false } }
    );

    await verifyUser(req, supabase);

    const mexal = buildMexalClient();
    const paymentsMap = await loadPaymentsMap(mexal);
    const clients = await loadAllClients(mexal, paymentsMap);

    const result = {
      letti_mexal: clients.length,
      inseriti_o_aggiornati: 0,
      disattivati: 0,
      errori: [],
    };

    if (clients.length === 0) {
      throw new Error(
        "Mexal non ha restituito alcun cliente con codice 501. La cache non è stata modificata per evitare disattivazioni errate."
      );
    }

    for (let index = 0; index < clients.length; index += UPSERT_BATCH_SIZE) {
      const batch = clients.slice(index, index + UPSERT_BATCH_SIZE);
      const range = `${index + 1}-${index + batch.length}`;

      const { error } = await supabase
        .from("ordini_clienti_cache")
        .upsert(batch, { onConflict: "codice_cliente" });

      if (error) {
        const formattedError = formatSupabaseError(error);
        console.error("Errore upsert clienti Mexal", {
          blocco: range,
          primo_codice: batch[0]?.codice_cliente,
          ultimo_codice: batch[batch.length - 1]?.codice_cliente,
          errore: formattedError,
        });

        result.errori.push({
          blocco: range,
          primo_codice: batch[0]?.codice_cliente || null,
          ultimo_codice: batch[batch.length - 1]?.codice_cliente || null,
          ...formattedError,
        });
      } else {
        result.inseriti_o_aggiornati += batch.length;
      }
    }

    if (result.errori.length === 0) {
      const activeCodes = new Set(
        clients.map((client) => client.codice_cliente)
      );

      const { data: cachedClients, error: cachedError } = await supabase
        .from("ordini_clienti_cache")
        .select("codice_cliente")
        .eq("sincronizzato_mexal", true)
        .eq("attivo_mexal", true)
        .like("codice_cliente", `${CLIENT_PREFIX}%`);

      if (cachedError) throw cachedError;

      const missingCodes = (cachedClients || [])
        .map((row) => normalize(row.codice_cliente))
        .filter((code) => code && !activeCodes.has(code));

      for (
        let index = 0;
        index < missingCodes.length;
        index += UPSERT_BATCH_SIZE
      ) {
        const batch = missingCodes.slice(index, index + UPSERT_BATCH_SIZE);
        const syncDate = new Date().toISOString();
        const range = `${index + 1}-${index + batch.length}`;

        const { error } = await supabase
          .from("ordini_clienti_cache")
          .update({
            attivo_mexal: false,
            sincronizzato_il: syncDate,
            ultimo_sync_mexal: syncDate,
          })
          .in("codice_cliente", batch);

        if (error) {
          const formattedError = formatSupabaseError(error);
          console.error("Errore disattivazione clienti Mexal", {
            blocco: range,
            errore: formattedError,
          });

          result.errori.push({
            blocco_disattivazione: range,
            ...formattedError,
          });
        } else {
          result.disattivati += batch.length;
        }
      }
    }

    return res.status(200).json(result);
  } catch (error) {
    console.error("Errore generale sincronizzazione clienti Mexal", {
      message: error?.message,
      stack: error?.stack,
    });

    return res.status(Number(error?.status || 500)).json({
      error: error?.message || "Errore sincronizzazione clienti Mexal.",
    });
  }
}
