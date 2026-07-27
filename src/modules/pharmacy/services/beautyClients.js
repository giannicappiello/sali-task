import { supabase } from "../../../lib/supabaseClient";

const PAGE_SIZE = 1000;

async function loadAllPages(buildQuery) {
  const rows = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await buildQuery(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    const page = data || [];
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
  }
}

export async function loadVisibleBeautyClients(user) {
  const admin = user?.external_role === "admin" || user?.ruolo === "admin";

  const [clients, linkRows] = await Promise.all([
    loadAllPages((from, to) => (admin
      ? supabase.from("ordini_clienti_cache").select("codice_cliente,ragione_sociale,indirizzo,localita,provincia,telefono,email,codice_agente_mexal").eq("attivo_mexal", true)
      : supabase.rpc("visible_mexal_clients_for_me"))
      .order("ragione_sociale")
      .order("codice_cliente")
      .range(from, to)),
    loadAllPages((from, to) => supabase
      .from("beauty_clienti_mexal")
      .select("codice_cliente,beauty_external_id,legacy_farmacia_id")
      .order("codice_cliente")
      .range(from, to)),
  ]);

  const links = new Map(linkRows.map((link) => [link.codice_cliente, link]));
  return clients.map((client) => {
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
