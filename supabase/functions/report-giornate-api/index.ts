import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const allowedTables = new Set([
  "allegati_giornata", "aperture_contatti", "beauty_consultant", "categorie_prodotti",
  "follow_up_giornate", "farmacie", "giornate_promozionali", "province", "regioni",
  "sottocategorie_prodotti", "vendite_prodotti", "agent", "utenti",
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

    const { data: profile } = await primary.from("utenti").select("id,nome,cognome,email,telefono,attivo,ruolo_id,mexal_agente_id,ruoli(nome,amministratore_workspace)").eq("auth_user_id", authData.user.id).maybeSingle();
    if (!profile || profile.attivo === false) return json({ error: "Utente non configurato o disabilitato" }, 403);

    const role = Array.isArray(profile.ruoli) ? profile.ruoli[0] : profile.ruoli;
    const { data: canonicalAdmin } = await primary.rpc("workspace_user_is_admin", {
      target_auth_user_id: authData.user.id,
    });
    const roleName = String(role?.nome || "").toLowerCase();
    const isAdmin = canonicalAdmin === true || role?.amministratore_workspace === true;
    const { data: permissionRows } = profile.ruolo_id
      ? await primary.from("permessi_utente").select("permessi(codice)").eq("utente_id", profile.id)
      : { data: [] };
    const canManageSettings = isAdmin || (permissionRows || []).some((row: any) =>
      ["settings.manage", "users.manage"].includes(String(row.permessi?.codice || ""))
    );
    const { data: integration } = isAdmin
      ? { data: null }
      : await primary.from("integrazioni_utenti").select("*").eq("utente_id", profile.id).eq("modulo", "report_giornate").maybeSingle();
    if (!isAdmin && (!integration || integration.enabled === false)) return json({ error: "Non sei autorizzato ad accedere a Beauty Days" }, 403);

    let access = integration || { enabled: true, access_level: "admin", external_role: "admin", allowed_pages: ["dashboard","aperture","giornate","analisi"], data_scope: {} };
    const report = createClient(reportUrl, reportServiceKey, { auth: { persistSession: false } });
    const body = await req.json();

    if (body.action === "context") {
      const expectedExternalId = access.external_role === "beauty"
        ? access.external_beauty_id
        : access.external_agent_id;
      if (!isAdmin && ["beauty", "agent"].includes(access.external_role) && !expectedExternalId) {
        const ensured = await ensureExternalUser(report, {
          ruolo: access.external_role,
          nome: profile.nome,
          cognome: profile.cognome,
          email: profile.email,
          telefono: profile.telefono,
          external_beauty_id: access.external_beauty_id,
          external_agent_id: access.external_agent_id,
        });
        const { error: updateError } = await primary
          .from("integrazioni_utenti")
          .update({
            external_user_id: ensured.external_user_id,
            external_beauty_id: ensured.external_beauty_id,
            external_agent_id: ensured.external_agent_id,
          })
          .eq("utente_id", profile.id)
          .eq("modulo", "report_giornate");
        if (updateError) throw updateError;
        access = { ...access, ...ensured };
      }
      const organizationScope = await loadOrganizationScope(primary, profile, access, isAdmin);
      return json({
        user_id: profile.id,
        external_user_id: access.external_user_id,
        external_role: isAdmin ? "admin" : access.external_role,
        external_beauty_id: access.external_beauty_id,
        external_agent_id: access.external_agent_id,
        visible_beauty_ids: organizationScope.visibleBeautyIds,
        access_level: isAdmin ? "admin" : access.access_level,
        allowed_pages: isAdmin
          ? ["dashboard","aperture","giornate","analisi"]
          : normalizeAllowedPages(access.allowed_pages),
      });
    }


    if (body.action === "ensure-external-user") {
      if (!canManageSettings) return json({ error: "Non hai il permesso di gestire gli accessi utenti." }, 403);

      const result = await ensureExternalUser(report, body);
      return json(result);
    }

    if (body.action === "ensure-client-link") {
      if (!isAdmin && !["write", "admin"].includes(access.access_level)) {
        return json({ error: "Accesso in sola lettura" }, 403);
      }
      const organizationScope = await loadOrganizationScope(primary, profile, access, isAdmin);
      const result = await ensureClientLink(primary, report, body.codice_cliente, organizationScope, isAdmin);
      return json(result);
    }

    if (body.action === "query") {
      const organizationScope = await loadOrganizationScope(primary, profile, access, isAdmin);
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
      if (!isAdmin) query = applyOrganizationScope(query, body.table, organizationScope);
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

  if (!nome || !email) {
    throw new Error("Nome ed email sono obbligatori.");
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

  return {
    success: true,
    external_user_id: null,
    external_beauty_id: externalBeautyId,
    external_agent_id: externalAgentId,
  };
}

async function ensureClientLink(primary: any, report: any, rawCode: unknown, scope: any, isAdmin: boolean) {
  const code = clean(rawCode);
  if (!code) throw new Error("Codice cliente mancante.");

  const existing = await primary
    .from("beauty_clienti_mexal")
    .select("codice_cliente,legacy_farmacia_id")
    .eq("codice_cliente", code)
    .maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data?.legacy_farmacia_id) {
    return { codice_cliente: code, legacy_farmacia_id: existing.data.legacy_farmacia_id };
  }

  const clientResult = await primary
    .from("ordini_clienti_cache")
    .select("codice_cliente,ragione_sociale,indirizzo,localita,telefono,email,codice_agente_mexal")
    .eq("codice_cliente", code)
    .eq("attivo_mexal", true)
    .maybeSingle();
  if (clientResult.error) throw clientResult.error;
  if (!clientResult.data) throw new Error("Cliente Mexal non trovato o non attivo.");

  if (!isAdmin) {
    const allowedCodes = new Set(scope.visibleAgentIds || []);
    const agentResult = await primary.from("mexal_agenti").select("id").eq("codice", clientResult.data.codice_agente_mexal).maybeSingle();
    if (agentResult.error) throw agentResult.error;
    if (!agentResult.data || !allowedCodes.has(agentResult.data.id)) throw new Error("Cliente fuori dal perimetro autorizzato.");
  }

  const created = await report
    .from("farmacie")
    .insert({
      nome: clientResult.data.ragione_sociale || code,
      indirizzo: clientResult.data.indirizzo || null,
      citta: clientResult.data.localita || null,
      telefono: clientResult.data.telefono || null,
      email: clientResult.data.email || null,
    })
    .select("id")
    .single();
  if (created.error) throw created.error;

  const saved = await primary.from("beauty_clienti_mexal").upsert({
    codice_cliente: code,
    legacy_farmacia_id: created.data.id,
    aggiornato_il: new Date().toISOString(),
  }, { onConflict: "codice_cliente" });
  if (saved.error) throw saved.error;
  return { codice_cliente: code, legacy_farmacia_id: created.data.id };
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

async function loadOrganizationScope(primary: any, profile: any, access: any, isAdmin: boolean) {
  if (isAdmin) return { visibleAgentIds: null, visibleBeautyIds: null };

  const visibleAgentIds = new Set<string>();
  if (profile.mexal_agente_id) visibleAgentIds.add(profile.mexal_agente_id);
  if (access.mexal_agente_id) visibleAgentIds.add(access.mexal_agente_id);

  const managed = await primary
    .from("mexal_agenti")
    .select("id")
    .eq("responsabile_utente_id", profile.id)
    .eq("attivo_mexal", true);
  if (managed.error) throw managed.error;
  for (const agent of managed.data || []) visibleAgentIds.add(agent.id);

  const ids = [...visibleAgentIds];
  if (!ids.length) {
    return {
      visibleAgentIds: [],
      visibleBeautyIds: access.external_beauty_id ? [access.external_beauty_id] : [],
    };
  }

  const beautyLinks = await primary
    .from("integrazioni_utenti")
    .select("external_beauty_id")
    .eq("modulo", "report_giornate")
    .eq("enabled", true)
    .in("mexal_agente_id", ids)
    .not("external_beauty_id", "is", null);
  if (beautyLinks.error) throw beautyLinks.error;

  const visibleBeautyIds = (beautyLinks.data || []).map((row: any) => row.external_beauty_id).filter(Boolean);
  if (access.external_beauty_id && !visibleBeautyIds.includes(access.external_beauty_id)) {
    visibleBeautyIds.push(access.external_beauty_id);
  }
  return { visibleAgentIds: ids, visibleBeautyIds };
}

function applyOrganizationScope(query: any, table: string, scope: any) {
  const beautyIds = scope.visibleBeautyIds || [];
  const none = "00000000-0000-0000-0000-000000000000";
  if (table === "beauty_consultant") return beautyIds.length ? query.in("id", beautyIds) : query.eq("id", none);
  if (table === "giornate_promozionali") return beautyIds.length ? query.in("consultant_id", beautyIds) : query.eq("consultant_id", none);
  if (table === "aperture_contatti") return beautyIds.length ? query.in("beauty_id", beautyIds) : query.eq("beauty_id", none);
  return query;
}

function normalizeAllowedPages(value: unknown) {
  const removed = new Set(["utenti", "farmacie", "clienti", "prodotti"]);
  return Array.isArray(value) ? [...new Set(value.filter((page) => !removed.has(page)))] : [];
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
