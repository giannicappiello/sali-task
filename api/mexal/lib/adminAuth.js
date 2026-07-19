import { createClient } from "@supabase/supabase-js";
const ADMIN_ROLES = new Set(["admin", "administrator", "amministratore", "super admin", "direzione"]);
export async function requireAdmin(req) {
  const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) throw Object.assign(new Error("Sessione non valida."), { status: 401 });
  const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const { data: { user }, error: authError } = await db.auth.getUser(token);
  if (authError || !user) throw Object.assign(new Error(authError?.message || "Sessione non valida."), { status: 401 });
  const { data: profile, error: profileError } = await db.from("utenti").select("attivo,ruoli(nome,livello)").eq("auth_user_id", user.id).maybeSingle();
  if (profileError) throw Object.assign(new Error(`Errore controllo amministratore: ${profileError.message}`), { status: 500 });
  const roleName = String(profile?.ruoli?.nome || "").trim().toLowerCase();
  if (!profile || profile.attivo === false || (Number(profile.ruoli?.livello || 0) < 80 && !ADMIN_ROLES.has(roleName))) throw Object.assign(new Error("Operazione riservata agli amministratori."), { status: 403 });
  return { db, token, user, profile };
}
