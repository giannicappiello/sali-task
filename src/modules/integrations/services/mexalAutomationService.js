function apiError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

export const SCHEDULE_SYNC_TYPES = ["clients", "agents", "products", "commercial_conditions", "document_series", "stocks", "list_price_commissions", "orders"];
export const EVENT_SYNC_TYPES = [...SCHEDULE_SYNC_TYPES, "payments"];
export const AUTOMATION_SECTION_COLUMNS = Object.freeze({
  schedule: ["Tipo sincronizzazione", "Frequenza", "Ordine", "Stato", "Azioni"],
  event: ["Evento", "Tipo sincronizzazione", "Ordine", "Stato", "Azioni"],
});

export function automationSection(type, canManage) {
  const event = type === "event";
  return {
    columns: AUTOMATION_SECTION_COLUMNS[event ? "event" : "schedule"],
    canCreate: Boolean(canManage && event),
    syncTypes: event ? EVENT_SYNC_TYPES : SCHEDULE_SYNC_TYPES,
  };
}

export function canManageMexalAutomations(canManage) { return Boolean(canManage); }

function messageForStatus(status) {
  if (status === 401) return "Sessione scaduta o non autorizzata. Accedi di nuovo per gestire le automazioni.";
  if (status === 403) return "Non disponi dei permessi amministrativi per gestire le automazioni.";
  if (status >= 500) return "Il servizio automazioni non è disponibile. Riprova tra qualche istante.";
  return "Impossibile completare la richiesta alle automazioni Mexal.";
}

async function accessTokenFor(supabase) {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw apiError(401, "Impossibile recuperare la sessione corrente.");
  const accessToken = data?.session?.access_token;
  if (!accessToken) throw apiError(401, "Sessione non disponibile. Accedi di nuovo per gestire le automazioni.");
  return accessToken;
}

async function postJson({ supabase, url, body, fetchImpl = fetch, invalidMessage }) {
  const accessToken = await accessTokenFor(supabase);
  let response;
  try {
    response = await fetchImpl(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw apiError(0, "Impossibile raggiungere il servizio Mexal. Controlla la connessione e riprova.");
  }

  let payload;
  try { payload = await response.json(); }
  catch { throw apiError(response.status, invalidMessage || "Il servizio Mexal ha restituito una risposta non valida."); }
  if (!response.ok) throw apiError(response.status, payload?.error || messageForStatus(response.status));
  return payload;
}

export async function requestMexalAutomation({ supabase, action, ruleType, rule, extraBody, fetchImpl = fetch }) {
  const body = { action, ...(extraBody || {}) };
  if (ruleType) body.ruleType = ruleType;
  if (rule) body.rule = rule;
  return postJson({
    supabase,
    url: "/api/mexal/automation",
    body,
    fetchImpl,
    invalidMessage: "Il servizio automazioni ha restituito una risposta non valida.",
  });
}

export async function startListPriceCommissionsNow({ supabase, batchSize = 250, fetchImpl = fetch }) {
  return postJson({
    supabase,
    url: "/api/mexal/orders/recover-sync",
    body: { action: "start-list-price-commissions-sync", batchSize },
    fetchImpl,
    invalidMessage: "L’avvio della sincronizzazione ha restituito una risposta non valida.",
  });
}

export async function processListPriceCommissionsBatchNow({ supabase, runId, fetchImpl = fetch }) {
  if (!runId) throw apiError(400, "Run di sincronizzazione non disponibile.");
  return postJson({
    supabase,
    url: "/api/mexal/orders/recover-sync",
    body: { action: "process-list-price-commissions-batch", runId },
    fetchImpl,
    invalidMessage: "Il batch della sincronizzazione ha restituito una risposta non valida.",
  });
}

export async function loadLatestListPriceCommissionRun({ supabase }) {
  const { data, error } = await supabase
    .from("mexal_sync_runs")
    .select("id,sync_type,status,started_at,completed_at,processed,inserted,updated,skipped,failed,error_message,metadata")
    .eq("sync_type", "list_price_commissions")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

export async function stopListPriceCommissionRun({ supabase, runId, fetchImpl = fetch }) {
  if (!runId) throw apiError(400, "Run di sincronizzazione non disponibile.");
  const payload = await requestMexalAutomation({ supabase, action: "stop", extraBody: { runId }, fetchImpl });
  return payload?.run || payload;
}

export async function loadMexalAutomationRules(options) {
  const payload = await requestMexalAutomation({ ...options, action: "rules_get" });
  if (!payload || !Array.isArray(payload.schedules) || !Array.isArray(payload.events)) {
    throw apiError(0, "Il servizio automazioni ha restituito dati non validi.");
  }
  return { schedules: payload.schedules, events: payload.events };
}

export async function saveMexalAutomationRule({ supabase, ruleType, rule, fetchImpl }) {
  const payload = await requestMexalAutomation({ supabase, action: "rules_save", ruleType, rule, fetchImpl });
  if (!payload || !payload.rule) throw apiError(0, "Il servizio automazioni non ha confermato il salvataggio della regola.");
  return payload.rule;
}
