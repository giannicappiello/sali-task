export async function requireAdmin(req, supabaseOrFactory) {
  const authorization = String(req.headers.authorization || "");
  if (!authorization.startsWith("Bearer ")) throw Object.assign(new Error("Sessione mancante."), { status: 401 });

  const supabase = typeof supabaseOrFactory === "function" ? supabaseOrFactory() : supabaseOrFactory;
  const { data: { user }, error: authError } = await supabase.auth.getUser(authorization.slice(7));
  if (authError || !user) throw Object.assign(new Error("Sessione non valida."), { status: 401 });

  const { data: profile, error: profileError } = await supabase
    .from("utenti")
    .select("id,attivo,ruoli(nome,amministratore_workspace)")
    .eq("auth_user_id", user.id)
    .maybeSingle();
  if (profileError || !profile || profile.attivo === false || profile.ruoli?.amministratore_workspace !== true) {
    throw Object.assign(new Error("Operazione riservata agli amministratori."), { status: 403 });
  }

  return { supabase, id: profile.id, authUserId: user.id };
}

export async function requirePermission(req, supabaseOrFactory, permissionCode) {
  const authorization = String(req.headers.authorization || "");
  if (!authorization.startsWith("Bearer ")) throw Object.assign(new Error("Sessione mancante."), { status: 401 });

  const supabase = typeof supabaseOrFactory === "function" ? supabaseOrFactory() : supabaseOrFactory;
  const { data: { user }, error: authError } = await supabase.auth.getUser(authorization.slice(7));
  if (authError || !user) throw Object.assign(new Error("Sessione non valida."), { status: 401 });

  const { data: profile, error: profileError } = await supabase
    .from("utenti")
    .select("id,attivo,ruolo_id,ruoli(amministratore_workspace,livello_accesso)")
    .eq("auth_user_id", user.id)
    .maybeSingle();
  if (profileError || !profile || profile.attivo === false) {
    throw Object.assign(new Error("Utente non configurato o disabilitato."), { status: 403 });
  }
  if (profile.ruoli?.amministratore_workspace === true || profile.ruoli?.livello_accesso === "amministrazione") {
    return { supabase, id: profile.id, authUserId: user.id };
  }

  const acceptedPermissions = (Array.isArray(permissionCode) ? permissionCode : [permissionCode]).filter(Boolean);
  const { data: permission, error: permissionError } = await supabase
    .from("permessi_utente")
    .select("permessi!inner(codice)")
    .eq("utente_id", profile.id)
    .in("permessi.codice", acceptedPermissions)
    .limit(1)
    .maybeSingle();
  if (permissionError || !permission) {
    throw Object.assign(new Error("Autorizzazione non concessa per questa operazione."), { status: 403 });
  }
  return { supabase, id: profile.id, authUserId: user.id };
}
