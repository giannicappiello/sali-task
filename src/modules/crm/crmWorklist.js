export const worklistCategories = {
  da_attivare: "Da attivare",
  primo_ordine_senza_seguito: "Primo ordine senza seguito",
  riordino_in_ritardo: "Riordino in ritardo",
  nessun_ordine_periodo: "Nessun ordine nel periodo",
};

export function filterCustomerWorklist(rows, { search = "", category = "", segment = "", mode = "follow-up" } = {}) {
  const query = search.trim().toLocaleLowerCase("it-IT");
  return rows.filter(row => {
    const eligible = segment ? row.classificazione === segment
      : mode === "reorders" ? Number(row.numero_ordini) > 0 : Boolean(row.categoria);
    return eligible && (!category || row.categoria === category)
      && (!query || `${row.ragione_sociale} ${row.codice_cliente}`.toLocaleLowerCase("it-IT").includes(query));
  }).sort((a, b) => Number(a.priorita) - Number(b.priorita)
    || String(a.contatto_consigliato_il || "").localeCompare(String(b.contatto_consigliato_il || ""))
    || a.ragione_sociale.localeCompare(b.ragione_sociale, "it")
    || a.codice_cliente.localeCompare(b.codice_cliente));
}

// Fetch all authorized customers, not only the API's first page. The SQL order
// has a stable customer-code tie breaker; aborted/stale requests never update UI.
export async function loadCustomerWorklist(client, from, to, signal) {
  const rows = []; const size = 500;
  for (let offset = 0; ; offset += size) {
    const { data, error } = await client.rpc("crm_b2b_followup_worklist", { period_from: from, period_to: to })
      .range(offset, offset + size - 1).abortSignal(signal);
    if (error) throw error;
    rows.push(...(data || []));
    if ((data || []).length < size) return rows;
  }
}
