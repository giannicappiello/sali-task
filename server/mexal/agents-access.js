function httpError(message, status = 500, details = null) {
  return Object.assign(new Error(message), { status, details });
}

async function findAuthUserByEmail(supabase, email) {
  let page = 1;
  while (page <= 20) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    const found = data?.users?.find((user) => String(user.email || "").toLowerCase() === email.toLowerCase());
    if (found) return found;
    if (!data?.nextPage || data.users.length < 1000) break;
    page += 1;
  }
  return null;
}

async function setAuthEnabled(supabase, authUserId, password, enabled) {
  if (!authUserId) return;
  const attributes = enabled
    ? { ...(password ? { password } : {}), ban_duration: "none" }
    : { ban_duration: "876000h" };
  const { error } = await supabase.auth.admin.updateUserById(authUserId, attributes);
  if (error) throw error;
}

export async function agentsAccess({ supabase, body }) {
  const agentId = String(body.agentId || "").trim();
  const accessAction = String(body.accessAction || "activate").trim();
  if (!agentId) throw httpError("Agente obbligatorio.", 400);

  const { data: agent, error: agentError } = await supabase
    .from("mexal_agenti")
    .select("*")
    .eq("id", agentId)
    .single();
  if (agentError) throw agentError;

  if (accessAction === "set_responsible") {
    const { data, error } = await supabase
      .from("mexal_agenti")
      .update({
        responsabile_utente_id: body.responsabileUtenteId || null,
        aggiornato_il: new Date().toISOString(),
      })
      .eq("id", agentId)
      .select()
      .single();
    if (error) throw error;
    return { success: true, agent: data };
  }

  if (accessAction === "disable") {
    let workspaceUser = null;
    if (agent.workspace_utente_id) {
      const result = await supabase
        .from("utenti")
        .select("id,auth_user_id")
        .eq("id", agent.workspace_utente_id)
        .maybeSingle();
      if (result.error) throw result.error;
      workspaceUser = result.data;
    }

    if (workspaceUser?.auth_user_id) {
      await setAuthEnabled(supabase, workspaceUser.auth_user_id, null, false);
    }
    if (workspaceUser?.id) {
      const { error } = await supabase.from("utenti").update({ attivo: false }).eq("id", workspaceUser.id);
      if (error) throw error;
    }

    const { data: updatedAgent, error } = await supabase
      .from("mexal_agenti")
      .update({ accesso_workspace_attivo: false, aggiornato_il: new Date().toISOString() })
      .eq("id", agentId)
      .select()
      .single();
    if (error) throw error;
    return { success: true, agent: updatedAgent };
  }

  if (agent.attivo_mexal === false) {
    throw httpError("L'agente risulta disattivato in Mexal e non può essere attivato in Workspace.", 409);
  }

  const password = String(body.password || "");
  if (password.length < 8) throw httpError("La password deve contenere almeno 8 caratteri.", 400);
  const email = String(agent.email || "").trim().toLowerCase();
  if (!email) throw httpError("L'agente non ha un indirizzo email in Mexal.", 400);

  let workspaceUser = null;
  if (agent.workspace_utente_id) {
    const result = await supabase
      .from("utenti")
      .select("id,auth_user_id,email")
      .eq("id", agent.workspace_utente_id)
      .maybeSingle();
    if (result.error) throw result.error;
    workspaceUser = result.data;
  }

  if (!workspaceUser) {
    const result = await supabase
      .from("utenti")
      .select("id,auth_user_id,email")
      .eq("agent_id", agent.id)
      .maybeSingle();
    if (result.error) throw result.error;
    workspaceUser = result.data;
  }

  if (!workspaceUser) {
    const result = await supabase
      .from("utenti")
      .select("id,auth_user_id,email")
      .ilike("email", email)
      .maybeSingle();
    if (result.error) throw result.error;
    workspaceUser = result.data;
  }

  let authUser = workspaceUser?.auth_user_id
    ? { id: workspaceUser.auth_user_id }
    : await findAuthUserByEmail(supabase, email);

  let createdAuthUser = false;
  if (!authUser) {
    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        nome: [agent.nome, agent.cognome].filter(Boolean).join(" ") || "Agente",
        codice_agente_mexal: agent.codice,
      },
    });
    if (error) throw error;
    authUser = data?.user;
    createdAuthUser = true;
  } else {
    await setAuthEnabled(supabase, authUser.id, password, true);
  }

  if (!authUser?.id) throw httpError("Supabase Auth non ha restituito l'identificativo utente.");

  const userValues = {
    auth_user_id: authUser.id,
    nome: [agent.nome, agent.cognome].filter(Boolean).join(" ") || "Agente",
    email,
    attivo: true,
    agent_id: agent.id,
    telefono: agent.telefono || null,
  };

  if (workspaceUser?.id) {
    const { data, error } = await supabase
      .from("utenti")
      .update(userValues)
      .eq("id", workspaceUser.id)
      .select("id,auth_user_id,email,attivo")
      .single();
    if (error) throw error;
    workspaceUser = data;
  } else {
    const { data, error } = await supabase
      .from("utenti")
      .upsert(userValues, { onConflict: "auth_user_id" })
      .select("id,auth_user_id,email,attivo")
      .single();
    if (error) {
      if (createdAuthUser) await supabase.auth.admin.deleteUser(authUser.id);
      throw error;
    }
    workspaceUser = data;
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
  if (linkError) throw linkError;

  return {
    success: true,
    updated: !createdAuthUser,
    userId: workspaceUser.id,
    agent: updatedAgent,
  };
}
