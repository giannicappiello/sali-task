import { createClient } from "@supabase/supabase-js";
import { requireAdmin } from "./lib/auth.js";

function required(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`Variabile Vercel mancante: ${name}`);
  return value;
}

function sendError(res, error) {
  const status = Number(error?.status || 500);
  return res.status(status >= 400 && status <= 599 ? status : 500).json({
    success: false,
    error: error?.message || "Errore gestione accesso agente.",
    details: error?.details || null,
  });
}

async function createAdmin(req) {
  const { supabase } = await requireAdmin(req, () => createClient(
    required("SUPABASE_URL"),
    required("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  ));
  return supabase;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ success: false, error: "Metodo non consentito." });

  try {
    const supabase = await createAdmin(req);
    const body = req.body || {};
    const agentId = String(body.agentId || "").trim();
    const accessAction = String(body.accessAction || "activate").trim();

    if (!agentId) throw Object.assign(new Error("Agente obbligatorio."), { status: 400 });

    const { data: agent, error: agentError } = await supabase
      .from("mexal_agenti")
      .select("*")
      .eq("id", agentId)
      .single();
    if (agentError) throw agentError;

    if (accessAction === "set_responsible") {
      const responsibleId = body.responsabileUtenteId || null;
      const { data, error } = await supabase
        .from("mexal_agenti")
        .update({ responsabile_utente_id: responsibleId, aggiornato_il: new Date().toISOString() })
        .eq("id", agentId)
        .select()
        .single();
      if (error) throw error;
      return res.status(200).json({ success: true, agent: data });
    }

    if (accessAction === "disable") {
      if (agent.workspace_utente_id) {
        const { data: userRow, error: userReadError } = await supabase
          .from("utenti")
          .select("auth_user_id")
          .eq("id", agent.workspace_utente_id)
          .maybeSingle();
        if (userReadError) throw userReadError;

        if (userRow?.auth_user_id) {
          const { error: banError } = await supabase.auth.admin.updateUserById(
            userRow.auth_user_id,
            { ban_duration: "876000h" },
          );
          if (banError) throw banError;
        }

        const { error: disableError } = await supabase
          .from("utenti")
          .update({ attivo: false })
          .eq("id", agent.workspace_utente_id);
        if (disableError) throw disableError;
      }

      const { error: agentDisableError } = await supabase
        .from("mexal_agenti")
        .update({ accesso_workspace_attivo: false, aggiornato_il: new Date().toISOString() })
        .eq("id", agentId);
      if (agentDisableError) throw agentDisableError;

      return res.status(200).json({ success: true });
    }

    const password = String(body.password || "");
    if (password.length < 8) throw Object.assign(new Error("La password deve contenere almeno 8 caratteri."), { status: 400 });
    if (!agent.email) throw Object.assign(new Error("L'agente non ha un indirizzo email in Mexal."), { status: 400 });

    if (agent.workspace_utente_id) {
      const { data: userRow, error: userError } = await supabase
        .from("utenti")
        .select("auth_user_id")
        .eq("id", agent.workspace_utente_id)
        .single();
      if (userError) throw userError;
      if (!userRow?.auth_user_id) throw new Error("L'utente Workspace collegato non dispone di auth_user_id.");

      const { error: updateAuthError } = await supabase.auth.admin.updateUserById(
        userRow.auth_user_id,
        { password, ban_duration: "none" },
      );
      if (updateAuthError) throw updateAuthError;

      const { error: userEnableError } = await supabase
        .from("utenti")
        .update({ attivo: true })
        .eq("id", agent.workspace_utente_id);
      if (userEnableError) throw userEnableError;

      const { data: updatedAgent, error: agentEnableError } = await supabase
        .from("mexal_agenti")
        .update({ accesso_workspace_attivo: true, aggiornato_il: new Date().toISOString() })
        .eq("id", agentId)
        .select()
        .single();
      if (agentEnableError) throw agentEnableError;

      return res.status(200).json({ success: true, updated: true, agent: updatedAgent });
    }

    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email: agent.email,
      password,
      email_confirm: true,
      user_metadata: {
        nome: agent.nome,
        cognome: agent.cognome,
        codice_agente_mexal: agent.codice,
      },
    });
    if (authError) throw authError;
    if (!authData?.user?.id) throw new Error("Supabase Auth non ha restituito l'identificativo del nuovo utente.");

    const { data: defaultRole, error: roleError } = await supabase
      .from("ruoli")
      .select("id")
      .order("livello", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (roleError) {
      await supabase.auth.admin.deleteUser(authData.user.id);
      throw roleError;
    }

    const { data: workspaceUser, error: workspaceError } = await supabase
      .from("utenti")
      .insert({
        auth_user_id: authData.user.id,
        nome: agent.nome || "Agente",
        cognome: agent.cognome || "",
        email: agent.email,
        attivo: true,
        ruolo_id: defaultRole?.id || null,
        mexal_agente_id: agent.id,
        codice_agente_mexal: agent.codice,
      })
      .select("id")
      .single();

    if (workspaceError) {
      await supabase.auth.admin.deleteUser(authData.user.id);
      throw workspaceError;
    }

    const { data: updatedAgent, error: linkError } = await supabase
      .from("mexal_agenti")
      .update({
        workspace_utente_id: workspaceUser.id,
        accesso_workspace_attivo: true,
        aggiornato_il: new Date().toISOString(),
      })
      .eq("id", agent.id)
      .select()
      .single();

    if (linkError) {
      await supabase.from("utenti").delete().eq("id", workspaceUser.id);
      await supabase.auth.admin.deleteUser(authData.user.id);
      throw linkError;
    }

    return res.status(200).json({ success: true, userId: workspaceUser.id, agent: updatedAgent });
  } catch (error) {
    return sendError(res, error);
  }
}
