import { createAdminClient, requireAdmin } from "./lib/admin.js";
import { runRegisteredSync, syncRegistry } from "./lib/syncRegistry.js";

function baseUrl(req) { const protocol = String(req.headers["x-forwarded-proto"] || "https").split(",")[0].trim(); return `${protocol}://${req.headers["x-forwarded-host"] || req.headers.host}`; }
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Metodo non consentito." });
  try {
    const admin = createAdminClient();
    await requireAdmin(req, admin);
    const syncType = req.body?.sync_type;
    const types = syncType === "sync_all" ? Object.keys(syncRegistry) : [syncType];
    if (!types.length || types.some((type) => !syncRegistry[type])) return res.status(400).json({ error: "Tipo sincronizzazione non supportato." });
    const results = [];
    for (const type of types) {
      try { results.push(await runRegisteredSync({ syncType: type, source: "manual", context: { requested_by: "automation-run-now" }, authorization: req.headers.authorization, baseUrl: baseUrl(req) })); }
      catch (error) { results.push({ success: false, syncType: type, error: error.message || "Errore sconosciuto." }); }
    }
    const completed = results.filter((item) => item.success).length;
    const failed = results.length - completed;
    return res.status(failed ? 207 : 200).json({ ok: failed === 0, results, counters: { requested: results.length, completed, failed } });
  } catch (error) { return res.status(Number(error.status || 500)).json({ error: error.message || "Impossibile avviare la sincronizzazione." }); }
}
