import https from "node:https";
import { createClient } from "@supabase/supabase-js";

const MODULE_CODE = "gestione_ordini";

function requireEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Variabile Vercel mancante: ${name}`);
  }
  return value;
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
        timeout: 30000,
      },
      (response) => {
        const chunks = [];

        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf8");

          resolve({
            status: response.statusCode || 500,
            headers: response.headers,
            body,
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

async function verifyUser(req) {
  const authorization = req.headers.authorization || "";

  if (!authorization.startsWith("Bearer ")) {
    throw Object.assign(new Error("Sessione mancante."), { status: 401 });
  }

  const supabase = createClient(
    requireEnv("SUPABASE_URL"),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false } }
  );

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

  const roleName = String(profile.ruoli?.nome || "").toLowerCase();
  const roleLevel = Number(profile.ruoli?.livello || 0);
  const isAdmin =
    ["admin", "administrator", "amministratore", "super admin", "direzione"].includes(
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

  const isBackoffice =
    integration?.enabled === true &&
    integration?.ruolo_ordini === "backoffice";

  if (!isBackoffice) {
    throw Object.assign(
      new Error("Operazione riservata ad amministratori e backoffice ordini."),
      { status: 403 }
    );
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Metodo non consentito." });
  }

  try {
    await verifyUser(req);

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

    const coordinateGestionale =
      `Azienda=${azienda} Anno=${anno} Magazzino=${magazzino}`;

    const mexalResponse = await requestMexal({
      url:
        `${baseUrl}/webapi/risorse/` +
        "dati-generali/gruppi-merceologici",
      headers: {
        Authorization: `Passepartout ${credential}`,
        "Coordinate-Gestionale": coordinateGestionale,
        Accept: "application/json",
      },
    });

    let parsedBody;

    try {
      parsedBody = JSON.parse(mexalResponse.body);
    } catch {
      parsedBody = null;
    }

    if (
      mexalResponse.status < 200 ||
      mexalResponse.status >= 300
    ) {
      return res.status(mexalResponse.status).json({
        error:
          parsedBody?.error?.["response-detail"] ||
          parsedBody?.error?.["response-message"] ||
          mexalResponse.body ||
          `Mexal HTTP ${mexalResponse.status}`,
      });
    }

    const groups = Array.isArray(parsedBody?.dati)
      ? parsedBody.dati
      : [];

    return res.status(200).json({
      ambiente: {
        base_url: baseUrl,
        azienda,
        anno,
        magazzino,
      },
      letti_mexal: groups.length,
      selezionati: groups.length,
      inseriti: 0,
      aggiornati: 0,
      immagini_salvate: 0,
      errori: [],
      dry_run: true,
      messaggio:
        "Connessione Vercel → Mexal verificata correttamente.",
    });
  } catch (error) {
    const status = Number(error?.status || 500);

    return res.status(status).json({
      error: error?.message || "Errore interno API Mexal.",
    });
  }
}
