const BATCH_SIZE = 12;

function requireCronSecret(req) {
  const secret = process.env.CRON_SECRET?.trim();
  const authorization = req.headers.authorization || "";

  if (!secret || authorization !== `Bearer ${secret}`) {
    const error = new Error("Cron non autorizzato.");
    error.status = 401;
    throw error;
  }

  return secret;
}

async function callSyncApi({ baseUrl, secret, offset, replaceStart, syncRunId }) {
  const response = await fetch(`${baseUrl}/api/mexal/automation`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${secret}`,
    },
    body: JSON.stringify({
      action: "run_now",
      syncType: "products",
      offset,
      batchSize: BATCH_SIZE,
      replaceStart,
      syncRunId,
    }),
  });

  const text = await response.text();
  let result;

  try {
    result = text ? JSON.parse(text) : {};
  } catch {
    result = { error: text || "Risposta API non valida." };
  }

  if (!response.ok) {
    throw new Error(result.error || `Errore sincronizzazione (${response.status}).`);
  }

  return result;
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Metodo non consentito." });
  }

  try {
    const secret = requireCronSecret(req);
    const host = req.headers["x-forwarded-host"] || req.headers.host;
    const protocol = req.headers["x-forwarded-proto"] || "https";
    const baseUrl = `${protocol}://${host}`;

    const first = await callSyncApi({
      baseUrl,
      secret,
      offset: 0,
      replaceStart: false,
    });

    const offsets = [];
    for (let offset = BATCH_SIZE; offset < Number(first.totale || 0); offset += BATCH_SIZE) {
      offsets.push(offset);
    }

    // I lotti sono sequenziali per conservare contatori e run coerenti. In
    // nessun caso l'API nasconde il catalogo prima dell'import completo.
    const remaining = [];
    let syncRunId = first.sync_run_id;
    for (const offset of offsets) {
      const item = await callSyncApi({
        baseUrl,
        secret,
        offset,
        replaceStart: false,
        syncRunId,
      });
      syncRunId = item.sync_run_id || syncRunId;
      remaining.push(item);
    }

    const all = [first, ...remaining];
    const summary = all.reduce(
      (acc, item) => {
        acc.inseriti += Number(item.inseriti || 0);
        acc.aggiornati += Number(item.aggiornati || 0);
        acc.immagini_salvate += Number(item.immagini_salvate || 0);
        acc.esclusi_non_attivi += Number(item.esclusi_non_attivi || 0);
        acc.esclusi_fuori_produzione += Number(item.esclusi_fuori_produzione || 0);
        acc.errori.push(...(item.errori || []));
        return acc;
      },
      {
        totale: Number(first.totale || 0),
        inseriti: 0,
        aggiornati: 0,
        immagini_salvate: 0,
        esclusi_non_attivi: 0,
        esclusi_fuori_produzione: 0,
        errori: [],
      }
    );

    return res.status(200).json({
      ok: true,
      eseguito_il: new Date().toISOString(),
      ...summary,
    });
  } catch (error) {
    return res.status(Number(error?.status || 500)).json({
      error: error?.message || "Errore sincronizzazione automatica Mexal.",
    });
  }
}
