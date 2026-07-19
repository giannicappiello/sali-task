import { createClient } from "@supabase/supabase-js";

const DEFAULT_ORDER = ["clients", "products", "commercial_conditions", "document_series", "stocks", "orders"];

function required(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`Variabile Vercel mancante: ${name}`);
  return value;
}

function requestBaseUrl(req) {
  const protocol = String(req.headers["x-forwarded-proto"] || "https").split(",")[0].trim();
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  return `${protocol}://${host}`;
}

async function callApi(fetchImpl, baseUrl, secret, path, body) {
  const response = await fetchImpl(`${baseUrl}${path}`, {
    method: body ? "POST" : "GET",
    headers: { Authorization: `Bearer ${secret}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const raw = await response.text();
  let result = {};
  try { result = raw ? JSON.parse(raw) : {}; } catch { result = { error: raw }; }
  if (!response.ok || result.success === false || result.ok === false) {
    throw new Error(result.error || `Sincronizzazione non riuscita (HTTP ${response.status}).`);
  }
  return result;
}

function endpointFor(syncType) {
  switch (syncType) {
    case "clients": return ["/api/mexal/sync-clients", { action: "sync", origin: "cron" }];
    case "products": return ["/api/cron/mexal-products", null];
    case "commercial_conditions": return ["/api/mexal/sync-commercial-conditions", { mode: "incremental", syncPayments: true, origin: "cron" }];
    case "document_series": return ["/api/mexal/sync-document-series", { origin: "cron" }];
    case "stocks": return ["/api/mexal/sync-products", { action: "sync-stock-it", offset: 0, batchSize: 12, origin: "cron" }];
    default: return null;
  }
}

export async function dispatchSchedules({ schedules, hasRunningRun, execute, updateSchedule }) {
  const executed = [];
  for (const schedule of schedules) {
    const sync_type = schedule.sync_type;
    const now = new Date().toISOString();
    try {
      if (await hasRunningRun(sync_type)) {
        const item = { sync_type, success: true, status: "skipped", error: "È già presente una sincronizzazione in corso per questo tipo." };
        await updateSchedule(schedule.id, { last_run_at: now, last_status: item.status, last_error: null, updated_at: now, next_run_at: null });
        executed.push(item);
        continue;
      }

      // Gli ordini restano monitorati: non esiste una coda automatica sicura
      // che possa garantire stato previsto e assenza di reinvii.
      if (sync_type === "orders") {
        const item = { sync_type, success: true, status: "skipped", error: null };
        await updateSchedule(schedule.id, { last_run_at: now, last_status: item.status, last_error: null, updated_at: now, next_run_at: null });
        executed.push(item);
        continue;
      }

      await execute(sync_type, schedule);
      const item = { sync_type, success: true, status: "completed", error: null };
      await updateSchedule(schedule.id, { last_run_at: now, last_status: item.status, last_error: null, updated_at: now, next_run_at: null });
      executed.push(item);
    } catch (error) {
      const item = { sync_type, success: false, status: "failed", error: error?.message || "Errore sconosciuto." };
      await updateSchedule(schedule.id, { last_run_at: now, last_status: item.status, last_error: item.error.slice(0, 1000), updated_at: now, next_run_at: null });
      executed.push(item);
    }
  }
  return { ok: executed.every((item) => item.success), executed };
}

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "Metodo non consentito." });
  if (!process.env.CRON_SECRET || req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ ok: false, error: "Cron non autorizzato." });
  }
  try {
    const admin = createClient(required("SUPABASE_URL"), required("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: schedules, error } = await admin.from("mexal_sync_schedules").select("id,sync_type,enabled,schedule_mode,batch_size,execution_order").eq("enabled", true).order("execution_order", { ascending: true });
    if (error) throw error;
    const rank = new Map(DEFAULT_ORDER.map((type, index) => [type, index]));
    const ordered = [...(schedules || [])].sort((a, b) => Number(a.execution_order) - Number(b.execution_order) || (rank.get(a.sync_type) ?? 99) - (rank.get(b.sync_type) ?? 99));
    const summary = await dispatchSchedules({
      schedules: ordered,
      hasRunningRun: async (syncType) => {
        const { data, error: runError } = await admin.from("mexal_sync_runs").select("id").eq("sync_type", syncType).eq("status", "running").limit(1);
        if (runError) throw runError;
        return Boolean(data?.length);
      },
      execute: async (syncType, schedule) => {
        const endpoint = endpointFor(syncType);
        if (!endpoint) throw new Error(`Tipo sincronizzazione non supportato: ${syncType}`);
        const [path, body] = endpoint;
        return callApi(fetch, requestBaseUrl(req), process.env.CRON_SECRET, path, body && { ...body, batchSize: schedule.batch_size || body.batchSize });
      },
      updateSchedule: async (id, values) => {
        const { error: updateError } = await admin.from("mexal_sync_schedules").update(values).eq("id", id);
        if (updateError) throw updateError;
      },
    });
    return res.status(200).json(summary);
  } catch (error) {
    return res.status(500).json({ ok: false, executed: [], error: error?.message || "Errore dispatcher Mexal." });
  }
}
