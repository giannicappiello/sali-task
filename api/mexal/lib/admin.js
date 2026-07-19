import { createClient } from "@supabase/supabase-js";

const ADMIN_ROLES = new Set(["admin", "administrator", "amministratore", "super admin", "direzione"]);

export function requireEnv(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`Variabile Vercel mancante: ${name}`);
  return value;
}

export function createAdminClient() {
  return createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function requireAdmin(req, admin) {
  const authorization = String(req.headers?.authorization || "");
  if (!authorization.startsWith("Bearer ")) throw Object.assign(new Error("Sessione mancante."), { status: 401 });
  const { data: { user }, error: authError } = await admin.auth.getUser(authorization.slice(7));
  if (authError || !user) throw Object.assign(new Error("Sessione non valida."), { status: 401 });
  const { data: profile, error } = await admin.from("utenti").select("id,attivo,ruoli(nome,livello)").eq("auth_user_id", user.id).maybeSingle();
  const role = String(profile?.ruoli?.nome || "").trim().toLowerCase();
  if (error || !profile || profile.attivo === false || (Number(profile.ruoli?.livello || 0) < 80 && !ADMIN_ROLES.has(role))) {
    throw Object.assign(new Error("Operazione riservata agli amministratori."), { status: 403 });
  }
  return { id: profile.id, authUserId: user.id };
}

export function isCronRequest(req) {
  const secret = String(process.env.CRON_SECRET || "").trim();
  return Boolean(secret) && req.headers?.authorization === `Bearer ${secret}`;
}
