import { createClient } from "@supabase/supabase-js";

const text = (value) => String(value ?? "").trim();
const denied = () => Object.assign(new Error("Accesso a OrdiniPrivate non autorizzato."), { status: 403 });

export async function readAllRows(queryFactory) {
  const rows = [];
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await queryFactory().range(offset, offset + 499);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < 500) return rows;
  }
}

export async function readRowsByIds(client, table, column, ids, select = "*") {
  const rows = [];
  const unique = [...new Set(ids.filter(Boolean))];
  for (let start = 0; start < unique.length; start += 100) {
    rows.push(...await readAllRows(() => client.from(table).select(select)
      .in(column, unique.slice(start, start + 100)).order("id")));
  }
  return rows;
}

// Fresh authorization on every request. Caller JWT keeps database RLS active;
// the explicit commercial filter matches useOrdersAccess("private").
export async function privateWorkbenchSession(req, dependencies = {}) {
  const authorization = text(req.headers?.authorization);
  if (!authorization.startsWith("Bearer ")) throw Object.assign(new Error("Sessione mancante."), { status: 401 });
  const env = globalThis.process.env;
  const options = { auth: { persistSession: false, autoRefreshToken: false } };
  const admin = dependencies.admin || createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, options);
  const { data, error } = await admin.auth.getUser(authorization.slice(7));
  if (error || !data?.user) throw Object.assign(new Error("Sessione non valida."), { status: 401 });
  const profileResult = await admin.from("utenti").select("id,attivo,ruoli(amministratore_workspace)")
    .eq("auth_user_id", data.user.id).maybeSingle();
  if (profileResult.error) throw profileResult.error;
  const profile = profileResult.data;
  if (!profile || profile.attivo === false) throw denied();
  const moduleResult = await admin.rpc("workspace_module_enabled_for_user", {
    target_user_id: profile.id, target_module: "ordini_private",
  });
  if (moduleResult.error) throw moduleResult.error;
  if (moduleResult.data !== true) throw denied();
  const caller = dependencies.caller || createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY || env.SUPABASE_SERVICE_ROLE_KEY, {
    ...options, global: { headers: { Authorization: authorization } },
  });
  const scopeResult = await caller.rpc("workspace_session_access");
  if (scopeResult.error) throw scopeResult.error;
  const snapshot = scopeResult.data;
  const scope = snapshot?.scope;
  if (!scope || typeof scope !== "object") throw denied();
  if (profile.ruoli?.amministratore_workspace !== true &&
      (snapshot.access?.module_levels?.ordini_private || snapshot.access?.role?.livello_accesso || "lettura") === "nessuno") throw denied();
  const customerCodes = (scope.customer_codes || (scope.customer_code ? [scope.customer_code] : [])).map(text).filter(Boolean);
  const isAdmin = profile.ruoli?.amministratore_workspace === true;
  if (!isAdmin && !customerCodes.length) {
    const integration = await admin.from("integrazioni_utenti").select("enabled")
      .eq("utente_id", profile.id).eq("modulo", "gestione_ordini_private").maybeSingle();
    if (integration.error) throw integration.error;
    if (integration.data?.enabled !== true) throw denied();
  }
  let filter = null;
  if (customerCodes.length) filter = { column: "codice_cliente", values: customerCodes };
  else if (!isAdmin && scope.private_commercial_read === true) {
    const result = await caller.rpc("workspace_private_customer_codes");
    if (result.error) throw result.error;
    filter = { column: "codice_cliente", values: result.data || [] };
  } else if (!isAdmin && (scope.commercial_mode || scope.mode) !== "tutti") {
    const result = await caller.rpc("visible_mexal_agent_codes");
    if (result.error) throw result.error;
    filter = { column: "codice_agente_mexal", values: result.data || [] };
  }
  const orders = await loadPrivateWorkbenchOrders(caller, filter);
  return { admin, orders, customerCodes };
}

export async function loadPrivateWorkbenchOrders(caller, filter) {
  if (filter && !filter.values.length) return [];
  const batches = filter ? Array.from({ length: Math.ceil(filter.values.length / 100) }, (_, i) => filter.values.slice(i * 100, i * 100 + 100)) : [null];
  const orders = [];
  for (const batch of batches) orders.push(...await readAllRows(() => {
    let query = caller.from("ordini_testate").select("*").eq("modulo_ordini", "private").order("id");
    if (batch) query = query.in(filter.column, batch);
    return query;
  }));
  return [...new Map(orders.map((order) => [order.id, order])).values()]
    .sort((a, b) => text(a.data_consegna || "9999").localeCompare(text(b.data_consegna || "9999")) || text(a.id).localeCompare(text(b.id)));
}

export function assertPrivateWorkbenchDetailScope(relatedOrderIds, allowedOrderIds) {
  const allowed = new Set(allowedOrderIds.map(text));
  if (!relatedOrderIds.length || relatedOrderIds.some((id) => !allowed.has(text(id)))) {
    throw Object.assign(new Error("OCT o RdP non disponibile: contiene ordini fuori dal tuo ambito autorizzato."), { status: 404 });
  }
}
