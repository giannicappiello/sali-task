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
  const acceptedPermissions = (Array.isArray(permissionCode) ? permissionCode : [permissionCode]).filter(Boolean);
  if (acceptedPermissions.length && acceptedPermissions.every((code) => code.startsWith("integrations."))) {
    const results = await Promise.all(acceptedPermissions.map((code) => supabase.rpc("workspace_screen_permission_for_user", {
      target_user_id: profile.id, permission_code: code,
    })));
    if (results.some((result) => result.error)) throw Object.assign(new Error("Verifica autorizzazioni non disponibile."), { status: 503 });
    if (!results.some((result) => result.data === true)) throw Object.assign(new Error("Autorizzazione non concessa per questa operazione."), { status: 403 });
    return { supabase, id: profile.id, authUserId: user.id };
  }
  if (profile.ruoli?.amministratore_workspace === true || profile.ruoli?.livello_accesso === "amministrazione") {
    return { supabase, id: profile.id, authUserId: user.id };
  }

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
