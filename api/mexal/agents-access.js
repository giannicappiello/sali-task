import { createClient } from "@supabase/supabase-js";
import { requireAdmin } from "./lib/auth.js";

function required(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`Variabile Vercel mancante: ${name}`);
  return value;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Metodo non consentito." });
  const adminClient = () => createClient(required("SUPABASE_URL"), required("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false, autoRefreshToken: false } });
  try {
    const { supabase } = await requireAdmin(req, adminClient);
    const agentId = String(req.body?.agentId || "").trim();
    const action = String(req.body?.action || "activate").trim();
    if (!agentId) return res.status(400).json({ error: "Agente obbligatorio." });
    const { data: agent, error: agentError } = await supabase.from("mexal_agenti").select("*").eq("id", agentId).single();
    if (agentError) throw agentError;

    if (action === "set_responsible") {
      const responsibleId = req.body?.responsabileUtenteId || null;
      const { data, error } = await supabase.from("mexal_agenti").update({ responsabile_utente_id: responsibleId, aggiornato_il: new Date().toISOString() }).eq("id", agentId).select().single();
      if (error) throw error;
      return res.status(200).json({ agent: data });
    }

    if (action === "disable") {
      if (agent.workspace_utente_id) {
        const { data: userRow } = await supabase.from("utenti").select("auth_user_id").eq("id", agent.workspace_utente_id).maybeSingle();
        if (userRow?.auth_user_id) await supabase.auth.admin.updateUserById(userRow.auth_user_id, { ban_duration: "876000h" });
        await supabase.from("utenti").update({ attivo: false }).eq("id", agent.workspace_utente_id);
      }
      await supabase.from("mexal_agenti").update({ accesso_workspace_attivo: false }).eq("id", agentId);
      return res.status(200).json({ success: true });
    }

    const password = String(req.body?.password || "");
    if (password.length < 8) return res.status(400).json({ error: "La password deve contenere almeno 8 caratteri." });
    if (!agent.email) return res.status(400).json({ error: "L'agente non ha un indirizzo email in Mexal." });

    if (agent.workspace_utente_id) {
      const { data: userRow, error: userError } = await supabase.from("utenti").select("auth_user_id").eq("id", agent.workspace_utente_id).single();
      if (userError) throw userError;
      const { error: updateAuthError } = await supabase.auth.admin.updateUserById(userRow.auth_user_id, { password, email_confirm: true, ban_duration: "none" });
      if (updateAuthError) throw updateAuthError;
      await supabase.from("utenti").update({ attivo: true }).eq("id", agent.workspace_utente_id);
      await supabase.from("mexal_agenti").update({ accesso_workspace_attivo: true }).eq("id", agentId);
      return res.status(200).json({ success: true, updated: true });
    }

    const { data: authData, error: authError } = await supabase.auth.admin.createUser({ email: agent.email, password, email_confirm: true, user_metadata: { nome: agent.nome, cognome: agent.cognome, codice_agente_mexal: agent.codice } });
    if (authError) throw authError;
    const { data: defaultRole } = await supabase.from("ruoli").select("id").order("livello", { ascending: true }).limit(1).maybeSingle();
    const { data: workspaceUser, error: workspaceError } = await supabase.from("utenti").insert({ auth_user_id: authData.user.id, nome: agent.nome || "Agente", cognome: agent.cognome || "", email: agent.email, attivo: true, ruolo_id: defaultRole?.id || null, mexal_agente_id: agent.id, codice_agente_mexal: agent.codice }).select("id").single();
    if (workspaceError) {
      await supabase.auth.admin.deleteUser(authData.user.id);
      throw workspaceError;
    }
    const { error: linkError } = await supabase.from("mexal_agenti").update({ workspace_utente_id: workspaceUser.id, accesso_workspace_attivo: true, aggiornato_il: new Date().toISOString() }).eq("id", agent.id);
    if (linkError) throw linkError;
    return res.status(200).json({ success: true, userId: workspaceUser.id });
  } catch (error) {
    return res.status(Number(error.status || 500)).json({ error: error.message || "Operazione non riuscita." });
  }
}