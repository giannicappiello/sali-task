export async function requireAdmin(req, supabaseOrFactory) {
  const authorization = String(req.headers.authorization || "");
  if (!authorization.startsWith("Bearer ")) throw Object.assign(new Error("Sessione mancante."), { status: 401 });

  const supabase = typeof supabaseOrFactory === "function" ? supabaseOrFactory() : supabaseOrFactory;
  const { data: { user }, error: authError } = await supabase.auth.getUser(authorization.slice(7));
  if (authError || !user) throw Object.assign(new Error("Sessione non valida."), { status: 401 });

  const { data: profile, error: profileError } = await supabase
    .from("utenti")
    .select("id,attivo,ruoli(nome,livello)")
    .eq("auth_user_id", user.id)
    .maybeSingle();
  const role = String(profile?.ruoli?.nome || "").toLowerCase();
  if (profileError || !profile || profile.attivo === false || !(Number(profile.ruoli?.livello || 0) >= 80 || ["admin", "administrator", "amministratore", "super admin", "direzione"].includes(role))) {
    throw Object.assign(new Error("Operazione riservata agli amministratori."), { status: 403 });
  }

  return { supabase, id: profile.id, authUserId: user.id };
}
