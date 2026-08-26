// @ts-check

import { createClient } from "@supabase/supabase-js";

/** @param {string} name */
function required(name) {
  const value = String(globalThis.process.env[name] ?? "").trim();
  if (!value) throw Object.assign(new Error(`Variabile Vercel mancante: ${name}`), { status: 500 });
  return value;
}

/**
 * Applica le stesse regole del modulo ProgreMES Workspace: sessione Supabase
 * valida, profilo attivo e modulo `progremes` abilitato per l'utente.
 * @param {{ headers?: Record<string, string | string[] | undefined> }} req
 * @param {{ admin?: any }} [dependencies]
 */
export async function requireProgremesReadonlyAccess(req, dependencies = {}) {
  const authorization = String(req.headers?.authorization ?? "");
  if (!authorization.startsWith("Bearer ")) {
    throw Object.assign(new Error("Sessione Workspace mancante."), { status: 401 });
  }

  const admin = dependencies.admin ?? createClient(required("SUPABASE_URL"), required("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: { user }, error: authError } = await admin.auth.getUser(authorization.slice(7));
  if (authError || !user) throw Object.assign(new Error("Sessione Workspace non valida."), { status: 401 });

  const { data: profile, error: profileError } = await admin
    .from("utenti")
    .select("id,attivo,ruoli(amministratore_workspace,livello_accesso)")
    .eq("auth_user_id", user.id)
    .maybeSingle();
  if (profileError) throw profileError;
  if (!profile || profile.attivo === false) {
    throw Object.assign(new Error("Utente Workspace non abilitato."), { status: 403 });
  }

  const { data: enabled, error: accessError } = await admin.rpc("workspace_module_enabled_for_user", {
    target_user_id: profile.id,
    target_module: "progremes",
  });
  if (accessError) throw accessError;
  if (enabled !== true) {
    throw Object.assign(new Error("Accesso al modulo ProgreMES non autorizzato."), { status: 403 });
  }
  if (["diagnostics", "diagnostics-health"].includes(String(req.query?.resource || ""))) {
    const isAdmin = profile.ruoli?.amministratore_workspace === true || profile.ruoli?.livello_accesso === "amministrazione";
    if (!isAdmin) {
      const { data: permissions, error: permissionError } = await admin.from("permessi_utente")
        .select("permessi!inner(codice)").eq("utente_id", profile.id)
        .in("permessi.codice", ["diagnostics.view"]).limit(1);
      if (permissionError) throw permissionError;
      if (!permissions?.length) throw Object.assign(new Error("Permesso diagnostics.view non concesso."), { status: 403 });
    }
  }
  return { authUserId: user.id, profileId: profile.id };
}
