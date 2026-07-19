import { createAdminClient, requireAdmin } from "./lib/admin.js";

const FIELDS = ["enabled", "execution_order", "batch_size"];
export default async function handler(req, res) {
  if (!["GET", "PATCH"].includes(req.method)) return res.status(405).json({ error: "Metodo non consentito." });
  try {
    const admin = createAdminClient();
    await requireAdmin(req, admin);
    if (req.method === "GET") {
      const { data, error } = await admin.from("mexal_sync_schedules").select("id,sync_type,enabled,batch_size,execution_order,last_run_at,last_status,last_error").order("execution_order");
      if (error) throw error;
      return res.status(200).json({ rules: data || [] });
    }
    const id = Number(req.body?.id);
    if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ error: "Regola automazione non valida." });
    const values = Object.fromEntries(FIELDS.filter((key) => Object.hasOwn(req.body || {}, key)).map((key) => [key, req.body[key]]));
    if (!Object.keys(values).length) return res.status(400).json({ error: "Nessuna modifica valida." });
    values.updated_at = new Date().toISOString();
    const { data, error } = await admin.from("mexal_sync_schedules").update(values).eq("id", id).select("id,sync_type,enabled,batch_size,execution_order,last_run_at,last_status,last_error").maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: "Regola automazione non trovata." });
    return res.status(200).json({ rule: data });
  } catch (error) { return res.status(Number(error.status || 500)).json({ error: error.message || "Impossibile gestire le automazioni." }); }
}
