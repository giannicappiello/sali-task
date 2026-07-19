import { createClient } from "@supabase/supabase-js";

const STOPPED_MESSAGE = "Sincronizzazione arrestata manualmente dall’amministratore.";

function requireEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Variabile Vercel mancante: ${name}`);
  return value;
}

async function requireAdmin(req, supabase) {
  const authorization = req.headers.authorization || "";
  if (!authorization.startsWith("Bearer ")) throw Object.assign(new Error("Sessione mancante."), { status: 401 });
  const { data: { user }, error: authError } = await supabase.auth.getUser(authorization.slice(7));
  if (authError || !user) throw Object.assign(new Error("Sessione non valida."), { status: 401 });
  const { data: profile, error } = await supabase.from("utenti").select("id,attivo,ruoli(nome,livello)").eq("auth_user_id", user.id).maybeSingle();
  const role = String(profile?.ruoli?.nome || "").toLowerCase();
  if (error || !profile || profile.attivo === false || !(Number(profile.ruoli?.livello || 0) >= 80 || ["admin", "administrator", "amministratore", "super admin", "direzione"].includes(role))) {
    throw Object.assign(new Error("Operazione riservata agli amministratori."), { status: 403 });
  }
  return { id: profile.id, authUserId: user.id };
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Metodo non consentito." });
  try {
    const supabase = createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
    const admin = await requireAdmin(req, supabase);
    const id = Number(req.body?.runId);
    if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ error: "ID run Mexal non valido." });
    const stoppedAt = new Date().toISOString();
    const { data: run, error: readError } = await supabase.from("mexal_sync_runs").select("id,status,metadata").eq("id", id).maybeSingle();
    if (readError) throw readError;
    if (!run) return res.status(404).json({ error: "Run Mexal non trovata." });
    if (run.status !== "running") return res.status(409).json({ error: "La run non è più in esecuzione.", run });
    const { data, error } = await supabase.from("mexal_sync_runs").update({
      status: "failed", completed_at: stoppedAt, error_message: STOPPED_MESSAGE,
      metadata: { ...(run.metadata || {}), stopped_manually: true, stopped_at: stoppedAt, stopped_by: admin.id, stopped_by_auth_user: admin.authUserId },
    }).eq("id", id).eq("status", "running").select("id,sync_type,status,started_at,completed_at,processed,inserted,updated,skipped,failed,error_message,metadata").maybeSingle();
    if (error) throw error;
    if (!data) return res.status(409).json({ error: "La run è stata già chiusa." });
    return res.status(200).json({ run: data, logicalStop: true });
  } catch (error) {
    return res.status(Number(error.status || 500)).json({ error: error.message || "Impossibile arrestare la sincronizzazione." });
  }
}
