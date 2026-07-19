import { createClient } from "@supabase/supabase-js";

const TIME_ZONE = "Europe/Rome";
const paths = { products: "/api/cron/mexal-products", clients: "/api/mexal/sync-clients", stocks: "/api/mexal/sync-products", commercial_conditions: "/api/mexal/sync-commercial-conditions", document_series: "/api/mexal/sync-document-series" };
const localParts = (date) => Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: TIME_ZONE, hour12: false, weekday: "short", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(date).filter((x) => x.type !== "literal").map((x) => [x.type, x.value]));
export function isDue(schedule, now = new Date()) {
  if (!schedule.enabled || schedule.schedule_mode === "manual") return false;
  if (schedule.next_run_at && new Date(schedule.next_run_at) > now) return false;
  const p = localParts(now);
  if (schedule.schedule_mode === "interval") return true;
  if (Number(schedule.hour) !== Number(p.hour) || Number(schedule.minute) !== Number(p.minute)) return false;
  return schedule.schedule_mode !== "weekly" || (schedule.days_of_week || []).includes(["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].indexOf(p.weekday));
}
export function nextRun(schedule, now = new Date()) { return new Date(now.getTime() + (schedule.schedule_mode === "interval" ? Number(schedule.frequency_minutes || 60) : 24 * 60) * 60000).toISOString(); }
function requireSecret(req) { if (!process.env.CRON_SECRET || req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) throw Object.assign(new Error("Cron non autorizzato."), { status: 401 }); }
export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Metodo non consentito." });
  try { requireSecret(req); const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
    const { data: running, error: runningError } = await db.from("mexal_sync_runs").select("id").eq("status", "running").limit(1); if (runningError) throw runningError;
    if (running?.length) return res.status(200).json({ ok: true, skipped: "sync_running" });
    const { data: schedules, error } = await db.from("mexal_sync_schedules").select("*").eq("enabled", true).order("next_run_at", { ascending: true, nullsFirst: true }); if (error) throw error;
    const schedule = (schedules || []).find((item) => isDue(item)); if (!schedule) return res.status(200).json({ ok: true, executed: [] });
    const path = paths[schedule.sync_type]; if (!path) return res.status(200).json({ ok: true, skipped: `unsupported:${schedule.sync_type}` });
    const host = req.headers["x-forwarded-host"] || req.headers.host; const protocol = req.headers["x-forwarded-proto"] || "https";
    const body = schedule.sync_type === "stocks" ? { action: "sync-stock-it", batchSize: schedule.batch_size, origin: "dispatcher" } : schedule.sync_type === "commercial_conditions" ? { mode: "incremental" } : {};
    const response = await fetch(`${protocol}://${host}${path}`, { method: schedule.sync_type === "products" ? "GET" : "POST", headers: { authorization: `Bearer ${process.env.CRON_SECRET}`, "content-type": "application/json" }, body: schedule.sync_type === "products" ? undefined : JSON.stringify(body) });
    const payload = await response.json().catch(() => ({})); const now = new Date().toISOString();
    await db.from("mexal_sync_schedules").update({ last_run_at: now, next_run_at: nextRun(schedule, new Date()), last_status: response.ok ? "completed" : "failed", last_error: response.ok ? null : String(payload.error || `HTTP ${response.status}`).slice(0, 500), updated_at: now }).eq("id", schedule.id);
    return res.status(response.ok ? 200 : 502).json({ ok: response.ok, executed: [schedule.sync_type], result: payload });
  } catch (error) { return res.status(error.status || 500).json({ error: error.message || "Errore dispatcher Mexal." }); }
}
