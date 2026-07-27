import { supabase } from "../../../lib/supabaseClient";

export async function loadVisibleBeautyClients(user) {
  const admin = user?.external_role === "admin" || user?.ruolo === "admin";
  const scopeResult = admin ? { data: null, error: null } : await supabase.rpc("visible_mexal_agent_codes");
  if (scopeResult.error) throw scopeResult.error;
  const visibleCodes = scopeResult.data || [];
  if (!admin && !visibleCodes.length) return [];

  let query = supabase
    .from("ordini_clienti_cache")
    .select("codice_cliente,ragione_sociale,indirizzo,localita,provincia,telefono,email,codice_agente_mexal")
    .eq("attivo_mexal", true)
    .order("ragione_sociale")
    .limit(1000);
  if (!admin) query = query.in("codice_agente_mexal", visibleCodes);

  const [clientsResult, linksResult] = await Promise.all([
    query,
    supabase.from("beauty_clienti_mexal").select("codice_cliente,beauty_external_id,legacy_farmacia_id"),
  ]);
  if (clientsResult.error || linksResult.error) throw clientsResult.error || linksResult.error;

  const links = new Map((linksResult.data || []).map((link) => [link.codice_cliente, link]));
  return (clientsResult.data || []).map((client) => {
    const link = links.get(client.codice_cliente);
    return {
      id: link?.legacy_farmacia_id || client.codice_cliente,
      codice_cliente: client.codice_cliente,
      nome: client.ragione_sociale,
      citta: client.localita,
      provincia: client.provincia,
      indirizzo: client.indirizzo,
      telefono: client.telefono,
      email: client.email,
      beauty_id: link?.beauty_external_id || null,
      codice_agente_mexal: client.codice_agente_mexal,
      legacy_farmacia_id: link?.legacy_farmacia_id || null,
    };
  });
}

export async function ensureBeautyClientLink(code) {
  const { data, error } = await supabase.functions.invoke("report-giornate-api", {
    body: { action: "ensure-client-link", codice_cliente: code },
  });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data;
}
