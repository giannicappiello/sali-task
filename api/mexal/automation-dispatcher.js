import { createClient } from "@supabase/supabase-js";
import { nextRunAt, executeActionChain } from "./lib/automationEngine.js";
import { runRegisteredSync } from "./lib/syncRegistry.js";
import { runSyncAll } from "./lib/runSyncAll.js";

const SUPPORTED_SYNCS = new Set(["clients", "products", "stocks", "commercial_conditions", "document_series"]);
const secretEquals = (provided, expected) => Boolean(expected && provided && provided.length === expected.length && [...provided].every((char, index) => char === expected[index]));
function baseUrl(req) { const protocol = String(req.headers["x-forwarded-proto"] || "https").split(",")[0]; return `${protocol}://${req.headers["x-forwarded-host"] || req.headers.host}`; }

export default async function handler(req, res) {
  if (!["GET", "POST"].includes(req.method)) return res.status(405).json({ ok: false, error: "Metodo non consentito." });
  const schedulerSecret = process.env.CRON_SECRET;
  const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!secretEquals(token, schedulerSecret)) return res.status(401).json({ ok: false, error: "Dispatcher non autorizzato." });
  try {
    const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    const now = new Date();
    const { data: rules, error } = await admin.from("mexal_automation_rules").select("*").eq("enabled", true).eq("automation_type", "scheduled").neq("frequency_type", "manual").lte("next_run_at", now.toISOString());
    if (error) throw error;
    const executed = [];
    for (const rule of rules || []) {
      // Optimistic lock: moving next_run_at means concurrent dispatchers cannot claim the same schedule.
      const lockUntil = new Date(now.getTime() + 5 * 60000).toISOString();
      const { data: locked, error: lockError } = await admin.from("mexal_automation_rules").update({ next_run_at: lockUntil }).eq("id", rule.id).eq("next_run_at", rule.next_run_at).select().maybeSingle();
      if (lockError) throw lockError;
      if (!locked) continue;
      const { data: run, error: runError } = await admin.from("mexal_automation_runs").insert({ automation_rule_id: rule.id, trigger_type: rule.trigger_type, status: "running" }).select().single();
      if (runError) throw runError;
      const chain = Array.isArray(rule.action_chain) ? rule.action_chain : [];
      const outcome = await executeActionChain({
        actions: chain,
        executeAction: async (action, order) => {
          const key = `${run.id}:${action.type}:${order}`;
          if (action.type === "sync_all") {
            const outcome = await runSyncAll({ db: admin, automationRunId: run.id, authorization: `Bearer ${process.env.CRON_SECRET}`, baseUrl: baseUrl(req), source: "automation", isStopped: async () => { const { data } = await admin.from("mexal_automation_runs").select("status").eq("id", run.id).single(); return data?.status === "stopped"; } });
            return { status: outcome.status, result: outcome, error: outcome.error };
          }
          const { data: existing } = await admin.from("mexal_automation_action_runs").select("id,status").eq("idempotency_key", key).maybeSingle();
          if (existing?.status === "completed") return { status: "skipped", result: { reason: "idempotent" } };
          await admin.from("mexal_automation_action_runs").insert({ automation_run_id: run.id, action_type: action.type, action_order: order, status: "running", started_at: new Date().toISOString(), idempotency_key: key });
          if (!SUPPORTED_SYNCS.has(action.type)) {
            const result = { status: "skipped", result: { reason: "Configurazione incompleta: azione non collegata a un endpoint Mexal verificato." } };
            await admin.from("mexal_automation_action_runs").update({ status: result.status, completed_at: new Date().toISOString(), result: result.result }).eq("idempotency_key", key);
            return result;
          }
          await runRegisteredSync({ syncType: action.type, source: "automation", authorization: `Bearer ${process.env.CRON_SECRET}`, baseUrl: baseUrl(req) });
          await admin.from("mexal_automation_action_runs").update({ status: "completed", completed_at: new Date().toISOString() }).eq("idempotency_key", key);
          return { status: "completed" };
        },
      });
      const completedAt = new Date().toISOString();
      await admin.from("mexal_automation_runs").update({ status: outcome.status, completed_at: completedAt, processed_actions: outcome.results.length, failed_actions: outcome.results.filter((item) => item.status === "failed").length, result: { actions: outcome.results }, error_message: outcome.error || null }).eq("id", run.id);
      await admin.from("mexal_automation_rules").update({ last_run_at: completedAt, next_run_at: nextRunAt(rule.frequency_type, new Date(completedAt), rule.configuration), updated_at: completedAt }).eq("id", rule.id);
      executed.push({ id: rule.id, status: outcome.status });
    }
    return res.status(200).json({ ok: true, executed });
  } catch (error) { return res.status(500).json({ ok: false, error: error.message || "Errore dispatcher Mexal." }); }
}
