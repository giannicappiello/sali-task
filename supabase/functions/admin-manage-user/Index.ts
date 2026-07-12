import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceRoleKey =
      Deno.env.get("SERVICE_ROLE_KEY") ||
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      throw new Error("Variabili ambiente Supabase mancanti.");
    }

    const authHeader = req.headers.get("Authorization");

    if (!authHeader) {
      return json({ error: "Non autenticato." }, 401);
    }

    const userClient = createClient(supabaseUrl, anonKey, {
      global: {
        headers: {
          Authorization: authHeader,
        },
      },
    });

    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });

    const {
      data: { user },
      error: userError,
    } = await userClient.auth.getUser();

    if (userError || !user) {
      return json({ error: "Sessione non valida." }, 401);
    }

    const { data: callerProfile, error: profileError } = await adminClient
      .from("utenti")
      .select(`
        id,
        auth_user_id,
        nome,
        cognome,
        email,
        ruoli(nome, livello)
      `)
      .eq("auth_user_id", user.id)
      .maybeSingle();

    if (profileError || !callerProfile) {
      return json({ error: "Profilo amministratore non trovato." }, 403);
    }

    const roleName = String(callerProfile.ruoli?.nome || "").toLowerCase();

    const isAdmin =
      ["admin", "administrator", "amministratore", "super admin"].includes(
        roleName
      ) || Number(callerProfile.ruoli?.livello || 0) >= 100;

    if (!isAdmin) {
      return json(
        { error: "Permesso negato. Solo admin può gestire utenti." },
        403
      );
    }

    const body = await req.json();
    const action = body.action;

    if (action === "create") {
      return await createUser(adminClient, body);
    }

    if (action === "update") {
      return await updateUser(adminClient, body);
    }

    if (action === "delete") {
      return await deleteUser(adminClient, body);
    }

    return json({ error: "Azione non valida." }, 400);
  } catch (error) {
    return json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Errore funzione admin.",
      },
      500
    );
  }
});

async function createUser(adminClient, body) {
  const nome = clean(body.nome);
  const cognome = clean(body.cognome);
  const email = clean(body.email).toLowerCase();
  const password = body.password || "";
  const telefono = clean(body.telefono) || null;
  const ruolo_id = body.ruolo_id || null;
  const reparto_id = body.reparto_id || null;
  const attivo = body.attivo !== false;

  if (!nome || !cognome || !email || !password) {
    return json(
      {
        error: "Nome, cognome, email e password sono obbligatori.",
      },
      400
    );
  }

  if (password.length < 8) {
    return json(
      { error: "La password deve avere almeno 8 caratteri." },
      400
    );
  }

  const fullName = `${nome} ${cognome}`.trim();

  const { data: created, error: authError } =
    await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        nome,
        cognome,
        full_name: fullName,
      },
    });

  if (authError) {
    return json({ error: authError.message }, 400);
  }

  const authUserId = created.user.id;

  const { data: profile, error: profileError } = await adminClient
    .from("utenti")
    .upsert(
      {
        auth_user_id: authUserId,
        nome,
        cognome,
        email,
        telefono,
        ruolo_id,
        reparto_id,
        attivo,
      },
      { onConflict: "email" }
    )
    .select("id")
    .single();

  if (profileError) {
    await adminClient.auth.admin.deleteUser(authUserId);

    return json(
      {
        error: profileError.message,
      },
      400
    );
  }

  return json({
    success: true,
    user_id: profile.id,
    auth_user_id: authUserId,
  });
}

async function updateUser(adminClient, body) {
  const id = body.id;
  const auth_user_id = body.auth_user_id || null;
  const nome = clean(body.nome);
  const cognome = clean(body.cognome);
  const email = clean(body.email).toLowerCase();
  const password = body.password || "";
  const telefono = clean(body.telefono) || null;
  const ruolo_id = body.ruolo_id || null;
  const reparto_id = body.reparto_id || null;
  const attivo = body.attivo !== false;

  if (!id || !nome || !cognome || !email) {
    return json(
      {
        error: "ID, nome, cognome ed email sono obbligatori.",
      },
      400
    );
  }

  const fullName = `${nome} ${cognome}`.trim();

  if (auth_user_id) {
    const authPayload = {
      email,
      user_metadata: {
        nome,
        cognome,
        full_name: fullName,
      },
    };

    if (password) {
      if (password.length < 8) {
        return json(
          {
            error: "La nuova password deve avere almeno 8 caratteri.",
          },
          400
        );
      }

      authPayload.password = password;
    }

    const { error: authError } =
      await adminClient.auth.admin.updateUserById(
        auth_user_id,
        authPayload
      );

    if (authError) {
      return json({ error: authError.message }, 400);
    }
  }

  const { error: profileError } = await adminClient
    .from("utenti")
    .update({
      nome,
      cognome,
      email,
      telefono,
      ruolo_id,
      reparto_id,
      attivo,
    })
    .eq("id", id);

  if (profileError) {
    return json({ error: profileError.message }, 400);
  }

  return json({ success: true });
}

async function deleteUser(adminClient, body) {
  const id = body.id;
  const auth_user_id = body.auth_user_id || null;

  if (!id) {
    return json({ error: "ID utente obbligatorio." }, 400);
  }

  const { data: localUser, error: localUserError } = await adminClient
    .from("utenti")
    .select("id,nome,cognome,email")
    .eq("id", id)
    .maybeSingle();

  if (localUserError) {
    return json({ error: localUserError.message }, 400);
  }

  const { data: integration, error: integrationError } = await adminClient
    .from("integrazioni_utenti")
    .select(
      "external_role,external_user_id,external_beauty_id,external_agent_id"
    )
    .eq("utente_id", id)
    .eq("modulo", "report_giornate")
    .maybeSingle();

  if (integrationError) {
    return json({ error: integrationError.message }, 400);
  }

  if (integration) {
    try {
      await deleteExternalPharmacyUser(integration, localUser);
    } catch (error) {
      return json(
        {
          error:
            error instanceof Error
              ? error.message
              : "Errore durante l'eliminazione dell'utente da Beauty Days.",
        },
        400
      );
    }
  }

  if (auth_user_id) {
    const { error: authError } =
      await adminClient.auth.admin.deleteUser(auth_user_id);

    if (authError) {
      return json({ error: authError.message }, 400);
    }
  } else {
    const { error: profileError } = await adminClient
      .from("utenti")
      .delete()
      .eq("id", id);

    if (profileError) {
      return json({ error: profileError.message }, 400);
    }
  }

  return json({ success: true });
}

async function deleteExternalPharmacyUser(integration, localUser) {
  const reportUrl = Deno.env.get("REPORT_GIORNATE_URL");
  const reportServiceKey = Deno.env.get(
    "REPORT_GIORNATE_SERVICE_ROLE_KEY"
  );

  if (!reportUrl || !reportServiceKey) {
    throw new Error(
      "Segreti Beauty Days non configurati nella funzione admin-manage-user."
    );
  }

  const reportClient = createClient(reportUrl, reportServiceKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  const externalRole = clean(integration.external_role).toLowerCase();
  const externalUserId = integration.external_user_id || null;
  const externalBeautyId = integration.external_beauty_id || null;
  const externalAgentId = integration.external_agent_id || null;
  const fullName = `${localUser?.cognome || ""} ${localUser?.nome || ""}`.trim();

  if (externalRole === "beauty" && externalBeautyId) {
    const { data: beautyRow, error: beautyReadError } = await reportClient
      .from("beauty_consultant")
      .select("id,nome,cognome")
      .eq("id", externalBeautyId)
      .maybeSingle();

    if (beautyReadError) throw beautyReadError;

    const historicalName = beautyRow
      ? `${beautyRow.cognome || ""} ${beautyRow.nome || ""}`.trim()
      : fullName;

    const preserveDays = await reportClient
      .from("giornate_promozionali")
      .update({
        consultant_id: null,
        consultant_nome_storico: historicalName || null,
      })
      .eq("consultant_id", externalBeautyId);

    if (preserveDays.error) throw preserveDays.error;

    const preserveContacts = await reportClient
      .from("aperture_contatti")
      .update({ beauty_id: null })
      .eq("beauty_id", externalBeautyId);

    if (preserveContacts.error) throw preserveContacts.error;

    const preservePharmacies = await reportClient
      .from("farmacie")
      .update({ beauty_id: null })
      .eq("beauty_id", externalBeautyId);

    if (preservePharmacies.error) throw preservePharmacies.error;

    const detachUsers = await reportClient
      .from("utenti")
      .update({ beauty_id: null })
      .eq("beauty_id", externalBeautyId);

    if (detachUsers.error) throw detachUsers.error;

    const deleteBeauty = await reportClient
      .from("beauty_consultant")
      .delete()
      .eq("id", externalBeautyId);

    if (deleteBeauty.error) throw deleteBeauty.error;
  }

  if (externalRole === "agent" && externalAgentId) {
    const detachBeauties = await reportClient
      .from("beauty_consultant")
      .update({ agent_id: null })
      .eq("agent_id", externalAgentId);

    if (detachBeauties.error) throw detachBeauties.error;

    const detachAgentUsers = await reportClient
      .from("utenti")
      .update({ agent_id: null })
      .eq("agent_id", externalAgentId);

    if (detachAgentUsers.error) throw detachAgentUsers.error;

    const deleteAgent = await reportClient
      .from("agent")
      .delete()
      .eq("id", externalAgentId);

    if (deleteAgent.error) throw deleteAgent.error;
  }

  if (externalUserId) {
    const preserveContactsByOperator = await reportClient
      .from("aperture_contatti")
      .update({ operatore_id: null })
      .eq("operatore_id", externalUserId);

    if (preserveContactsByOperator.error) {
      throw preserveContactsByOperator.error;
    }

    const deleteRemoteProfile = await reportClient
      .from("utenti")
      .delete()
      .eq("id", externalUserId);

    if (deleteRemoteProfile.error) throw deleteRemoteProfile.error;

    const { data: remoteAuthUser, error: remoteAuthReadError } =
      await reportClient.auth.admin.getUserById(externalUserId);

    if (remoteAuthReadError && remoteAuthReadError.status !== 404) {
      throw remoteAuthReadError;
    }

    if (remoteAuthUser?.user) {
      const { error: remoteAuthDeleteError } =
        await reportClient.auth.admin.deleteUser(externalUserId);

      if (remoteAuthDeleteError) throw remoteAuthDeleteError;
    }
  }
}

function clean(value) {
  return String(value || "").trim();
}

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}
