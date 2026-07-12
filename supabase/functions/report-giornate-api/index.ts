import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const allowedTables = new Set([
  "allegati_giornata", "aperture_contatti", "beauty_consultant", "categorie_prodotti",
  "follow_up_giornate", "farmacie", "giornate_promozionali", "province", "regioni",
  "prodotti", "sottocategorie_prodotti", "vendite_prodotti", "agent", "utenti",
]);
const allowedBuckets = new Set(["allegati-giornate", "allegati_giornate"]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader.startsWith("Bearer ")) return json({ error: "Sessione mancante" }, 401);

    const primaryUrl = Deno.env.get("SUPABASE_URL")!;
    const primaryServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const reportUrl = Deno.env.get("REPORT_GIORNATE_URL")!;
    const reportServiceKey = Deno.env.get("REPORT_GIORNATE_SERVICE_ROLE_KEY")!;
    if (!reportUrl || !reportServiceKey) return json({ error: "Segreti report-giornate non configurati" }, 500);

    const primary = createClient(primaryUrl, primaryServiceKey, { auth: { persistSession: false } });
    const token = authHeader.slice(7);
    const { data: authData, error: authError } = await primary.auth.getUser(token);
    if (authError || !authData.user) return json({ error: "Sessione non valida" }, 401);

    const { data: profile } = await primary.from("utenti").select("id,nome,cognome,email,telefono,attivo,ruolo_id,ruoli(nome,livello)").eq("auth_user_id", authData.user.id).maybeSingle();
    if (!profile || profile.attivo === false) return json({ error: "Utente non configurato o disabilitato" }, 403);

    const roleName = String(profile.ruoli?.nome || "").toLowerCase();
    const isAdmin = ["admin", "administrator", "amministratore", "super admin", "direzione"].includes(roleName) || Number(profile.ruoli?.livello || 0) >= 80;
    const { data: integration } = await primary.from("integrazioni_utenti").select("*").eq("utente_id", profile.id).eq("modulo", "report_giornate").maybeSingle();
    if (!isAdmin && (!integration || integration.enabled === false)) return json({ error: "Non sei autorizzato ad accedere a Gestione Farmacie" }, 403);

    const access = integration || { enabled: true, access_level: "admin", external_role: "admin", allowed_pages: ["dashboard","aperture","giornate","analisi","prodotti","farmacie","utenti"], data_scope: {} };
    const report = createClient(reportUrl, reportServiceKey, { auth: { persistSession: false } });
    const body = await req.json();

    if (body.action === "context") {
      return json({
        user_id: profile.id,
        external_user_id: access.external_user_id,
        external_role: isAdmin ? "admin" : access.external_role,
        external_beauty_id: access.external_beauty_id,
        external_agent_id: access.external_agent_id,
        access_level: isAdmin ? "admin" : access.access_level,
        allowed_pages: isAdmin ? ["dashboard","aperture","giornate","analisi","prodotti","farmacie","utenti"] : (access.allowed_pages || []),
      });
    }


    if (body.action === "ensure-external-user") {
      if (!isAdmin) return json({ error: "Operazione riservata agli amministratori" }, 403);

      const result = await ensureExternalUser(report, body);
      return json(result);
    }

    if (body.action === "query") {
      if (!allowedTables.has(body.table)) return json({ error: `Tabella non autorizzata: ${body.table}` }, 403);
      const write = ["insert", "update", "delete"].includes(body.operation);
      if (write && !isAdmin && !["write", "admin"].includes(access.access_level)) return json({ error: "Accesso in sola lettura" }, 403);
      let query: any;
      if (body.operation === "insert") {
        const defaults = access.data_scope?.insert_defaults?.[body.table] || {};
        const values = Array.isArray(body.values) ? body.values.map((v: any) => ({ ...v, ...defaults })) : { ...body.values, ...defaults };
        query = report.from(body.table).insert(values);
        if (body.columns) query = query.select(body.columns);
      } else if (body.operation === "update") {
        query = report.from(body.table).update(body.values);
        if (body.columns) query = query.select(body.columns);
      } else if (body.operation === "delete") {
        query = report.from(body.table).delete();
      } else {
        query = report.from(body.table).select(body.columns || "*", body.selectOptions || {});
      }

      for (const f of (body.filters || [])) query = applyFilter(query, f);
      const scoped = access.data_scope?.filters?.[body.table] || {};
      if (!isAdmin) for (const [column, value] of Object.entries(scoped)) query = Array.isArray(value) ? query.in(column, value) : query.eq(column, value);
      if (body.modifiers?.order) query = query.order(body.modifiers.order.column, { ascending: body.modifiers.order.ascending });
      if (body.modifiers?.range) query = query.range(body.modifiers.range.from, body.modifiers.range.to);
      if (body.modifiers?.limit) query = query.limit(body.modifiers.limit);
      if (body.modifiers?.single) query = query.single();
      if (body.modifiers?.maybeSingle) query = query.maybeSingle();
      const result = await query;
      if (result.error) return json({ error: result.error.message, details: result.error.details }, 400);
      return json({ data: result.data, count: result.count ?? null });
    }

    if (body.action === "storage-upload") {
      if (!allowedBuckets.has(body.bucket)) return json({ error: "Bucket non autorizzato" }, 403);
      if (!isAdmin && !["write", "admin"].includes(access.access_level)) return json({ error: "Accesso in sola lettura" }, 403);
      const bytes = Uint8Array.from(atob(body.base64), (c) => c.charCodeAt(0));
      const result = await report.storage.from(body.bucket).upload(body.path, bytes, { contentType: body.contentType, upsert: body.upsert === true });
      if (result.error) return json({ error: result.error.message }, 400);
      return json({ data: result.data });
    }

    if (body.action === "storage-remove") {
      if (!allowedBuckets.has(body.bucket)) return json({ error: "Bucket non autorizzato" }, 403);
      if (!isAdmin && !["write", "admin"].includes(access.access_level)) return json({ error: "Accesso in sola lettura" }, 403);
      const result = await report.storage.from(body.bucket).remove(body.paths || []);
      if (result.error) return json({ error: result.error.message }, 400);
      return json({ data: result.data });
    }

    if (body.action === "remote-function") {
      if (!isAdmin && access.access_level !== "admin") return json({ error: "Funzione riservata agli amministratori" }, 403);
      const result = await report.functions.invoke(body.functionName, { body: body.payload || {} });
      if (result.error) return json({ error: result.error.message }, 400);
      return json({ data: result.data });
    }

    return json({ error: "Operazione non riconosciuta" }, 400);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});


async function ensureExternalUser(report: any, body: any) {
  const ruolo = clean(body.ruolo).toLowerCase();
  const nome = clean(body.nome);
  const cognome = clean(body.cognome);
  const email = clean(body.email).toLowerCase();
  const telefono = clean(body.telefono) || null;

  if (!["beauty", "agent"].includes(ruolo)) {
    throw new Error("La creazione automatica è disponibile solo per Beauty e Agente.");
  }

  if (!nome || !cognome || !email) {
    throw new Error("Nome, cognome ed email sono obbligatori.");
  }

  let externalAgentId = body.external_agent_id || null;
  let externalBeautyId = body.external_beauty_id || null;

  if (ruolo === "agent") {
    let agentRow = null;

    if (externalAgentId) {
      const existingById = await report
        .from("agent")
        .select("*")
        .eq("id", externalAgentId)
        .maybeSingle();

      if (existingById.error) throw existingById.error;
      agentRow = existingById.data;
    }

    if (!agentRow) {
      const existingByEmail = await report
        .from("agent")
        .select("*")
        .ilike("email", email)
        .maybeSingle();

      if (existingByEmail.error) throw existingByEmail.error;
      agentRow = existingByEmail.data;
    }

    if (agentRow) {
      const updated = await report
        .from("agent")
        .update({ nome, cognome, email, telefono, attivo: true })
        .eq("id", agentRow.id)
        .select("id")
        .single();

      if (updated.error) throw updated.error;
      externalAgentId = updated.data.id;
    } else {
      const inserted = await report
        .from("agent")
        .insert({ nome, cognome, email, telefono, attivo: true })
        .select("id")
        .single();

      if (inserted.error) throw inserted.error;
      externalAgentId = inserted.data.id;
    }
  }

  if (ruolo === "beauty") {
    let beautyRow = null;

    if (externalBeautyId) {
      const existingById = await report
        .from("beauty_consultant")
        .select("*")
        .eq("id", externalBeautyId)
        .maybeSingle();

      if (existingById.error) throw existingById.error;
      beautyRow = existingById.data;
    }

    if (!beautyRow) {
      const existingByEmail = await report
        .from("beauty_consultant")
        .select("*")
        .ilike("email", email)
        .maybeSingle();

      if (existingByEmail.error) throw existingByEmail.error;
      beautyRow = existingByEmail.data;
    }

    const beautyPayload = {
      nome,
      cognome,
      email,
      telefono,
      agent_id: externalAgentId || null,
      attivo: true,
    };

    if (beautyRow) {
      const updated = await report
        .from("beauty_consultant")
        .update(beautyPayload)
        .eq("id", beautyRow.id)
        .select("id")
        .single();

      if (updated.error) throw updated.error;
      externalBeautyId = updated.data.id;
    } else {
      const inserted = await report
        .from("beauty_consultant")
        .insert(beautyPayload)
        .select("id")
        .single();

      if (inserted.error) throw inserted.error;
      externalBeautyId = inserted.data.id;
    }
  }

  let authUser = null;
  const listed = await report.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (listed.error) throw listed.error;
  authUser = listed.data.users.find(
    (user: any) => String(user.email || "").toLowerCase() === email
  );

  if (!authUser) {
    const randomPassword = `Tmp!${crypto.randomUUID()}aA1`;
    const created = await report.auth.admin.createUser({
      email,
      password: randomPassword,
      email_confirm: true,
      user_metadata: {
        nome,
        cognome,
        full_name: `${nome} ${cognome}`.trim(),
      },
    });

    if (created.error) throw created.error;
    authUser = created.data.user;
  } else {
    const updatedAuth = await report.auth.admin.updateUserById(authUser.id, {
      user_metadata: {
        ...(authUser.user_metadata || {}),
        nome,
        cognome,
        full_name: `${nome} ${cognome}`.trim(),
      },
    });

    if (updatedAuth.error) throw updatedAuth.error;
  }

  const userName = `${cognome} ${nome}`.trim();
  const existingRemoteUser = await report
    .from("utenti")
    .select("*")
    .ilike("email", email)
    .maybeSingle();

  if (existingRemoteUser.error) throw existingRemoteUser.error;

  let externalUserId = existingRemoteUser.data?.id || authUser.id;
  const userPayload = {
    nome: userName,
    email,
    ruolo,
    beauty_id: ruolo === "beauty" ? externalBeautyId : null,
    agent_id: ruolo === "agent" ? externalAgentId : null,
    attivo: true,
  };

  if (existingRemoteUser.data) {
    const updatedUser = await report
      .from("utenti")
      .update(userPayload)
      .eq("id", existingRemoteUser.data.id)
      .select("id")
      .single();

    if (updatedUser.error) throw updatedUser.error;
    externalUserId = updatedUser.data.id;
  } else {
    const insertedUser = await report
      .from("utenti")
      .insert({ id: authUser.id, ...userPayload })
      .select("id")
      .single();

    if (insertedUser.error) throw insertedUser.error;
    externalUserId = insertedUser.data.id;
  }

  return {
    success: true,
    external_user_id: externalUserId,
    external_beauty_id: externalBeautyId,
    external_agent_id: externalAgentId,
  };
}

function clean(value: unknown) {
  return String(value || "").trim();
}

function applyFilter(query: any, f: any) {
  if (!f?.column) throw new Error("Filtro non valido: colonna mancante");
  if (f.value === undefined || f.value === null || f.value === "undefined" || f.value === "null") {
    throw new Error(`Filtro non valido: ${f.column} non ha un valore valido`);
  }
  if (f.type === "eq") return query.eq(f.column, f.value);
  if (f.type === "in") return query.in(f.column, f.value);
  if (f.type === "filter") return query.filter(f.column, f.operator, f.value);
  return query;
}
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
