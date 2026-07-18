import https from "node:https";
import { createClient } from "@supabase/supabase-js";

const MODULE_CODE = "gestione_ordini";
const CLIENT_PREFIX = "501";
const PAGE_SIZE = 500;

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
  if (Array.isArray(response?.dati)) return response.dati;
  if (Array.isArray(response?.records)) return response.records;
  if (Array.isArray(response?.items)) return response.items;
  return [];
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
    baseUrl,
    azienda,
    anno,
    magazzino,
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
    ["ADMIN", "ADMINISTRATOR", "AMMINISTRATORE", "SUPER ADMIN", "DIREZIONE"].includes(
      roleName
    ) || roleLevel >= 80;

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

function mapClient(client) {
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

  const address = normalize(
    firstValue(client, ["indirizzo", "via", "indirizzo_sede", "indirizzo1"])
  );
  const postalCode = normalize(firstValue(client, ["cap", "codice_postale"]));
  const city = normalize(
    firstValue(client, ["localita", "citta", "comune", "località"])
  );
  const province = upper(firstValue(client, ["provincia", "prov", "sigla_provincia"]));
  const country = upper(firstValue(client, ["nazione", "paese", "codice_nazione"], "IT"));

  const payment = normalize(
    firstValue(client, [
      "codice_pagamento",
      "pagamento",
      "cod_pagamento",
      "condizione_pagamento",
    ])
  );
  const priceList = normalize(
    firstValue(client, ["codice_listino", "listino", "cod_listino", "nr_listino"])
  );

  const activeFlag = upper(
    firstValue(client, ["gest_annullato", "annullato", "precancellato"], "N")
  );

  return {
    codice_cliente: code,
    ragione_sociale: companyName || code,
    indirizzo: address || null,
    cap: postalCode || null,
    localita: city || null,
    provincia: province || null,
    nazione: country || null,
    partita_iva: normalize(
      firstValue(client, ["partita_iva", "piva", "p_iva", "vat_number"])
    ) || null,
    codice_fiscale: normalize(
      firstValue(client, ["codice_fiscale", "cod_fiscale", "cf"])
    ) || null,
    telefono: normalize(firstValue(client, ["telefono", "tel", "telefono1"])) || null,
    email: normalize(firstValue(client, ["email", "mail", "posta_elettronica"])) || null,
    pec: normalize(firstValue(client, ["pec", "email_pec"])) || null,
    codice_sdi: normalize(firstValue(client, ["codice_sdi", "cod_destinatario"])) || null,
    codice_pagamento: payment || null,
    descrizione_pagamento: normalize(
      firstValue(client, ["descrizione_pagamento", "desc_pagamento"])
    ) || null,
    codice_listino: priceList || null,
    codice_agente_mexal: getAgentCode(client) || null,
    sconto_1: Number(firstValue(client, ["sconto_1", "sconto1", "sconto_cliente_1"], 0)) || 0,
    sconto_2: Number(firstValue(client, ["sconto_2", "sconto2", "sconto_cliente_2"], 0)) || 0,
    sconto_3: Number(firstValue(client, ["sconto_3", "sconto3", "sconto_cliente_3"], 0)) || 0,
    attivo_mexal: !["S", "Y", "TRUE", "1"].includes(activeFlag),
    sincronizzato_mexal: true,
    ultimo_sync_mexal: new Date().toISOString(),
    json_mexal: client,
    updated_at: new Date().toISOString(),
  };
}

async function loadAllClients(mexal) {
  const rows = [];
  let next = null;
  let page = 0;

  do {
    const params = new URLSearchParams();
    params.set("info", "true");
    params.set("max", String(PAGE_SIZE));
    if (next) params.set("next", next);

    const response = await mexal.get(`/clienti?${params.toString()}`);
    rows.push(...extractRows(response));
    next = response?.next ? String(response.next) : null;
    page += 1;

    if (page > 200) {
      throw new Error("Paginazione clienti Mexal interrotta: troppe pagine.");
    }
  } while (next);

  return rows
    .map(mapClient)
    .filter((client) => client.codice_cliente.startsWith(CLIENT_PREFIX));
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
    const clients = await loadAllClients(mexal);

    const result = {
      letti_mexal: clients.length,
      inseriti_o_aggiornati: 0,
      disattivati: 0,
      errori: [],
    };

    const { error: hideError } = await supabase
      .from("ordini_clienti_cache")
      .update({ attivo_mexal: false })
      .eq("sincronizzato_mexal", true);

    if (hideError) throw hideError;

    for (let index = 0; index < clients.length; index += 100) {
      const batch = clients.slice(index, index + 100);
      const { error } = await supabase
        .from("ordini_clienti_cache")
        .upsert(batch, { onConflict: "codice_cliente" });

      if (error) {
        result.errori.push({
          blocco: `${index + 1}-${index + batch.length}`,
          errore: error.message,
        });
      } else {
        result.inseriti_o_aggiornati += batch.length;
      }
    }

    const { count: inactiveCount } = await supabase
      .from("ordini_clienti_cache")
      .select("*", { count: "exact", head: true })
      .eq("attivo_mexal", false);

    result.disattivati = inactiveCount || 0;

    return res.status(200).json(result);
  } catch (error) {
    return res.status(Number(error?.status || 500)).json({
      error: error?.message || "Errore sincronizzazione clienti Mexal.",
    });
  }
}
