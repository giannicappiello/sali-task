const PAGE_SIZE = 1000;

export async function loadWorkspaceWarehouse(db) {
  const rows = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await db
      .from("ordini_prodotti_cache")
      .select("codice_articolo,descrizione,unita_misura,giacenza,impegnato,disponibilita,costo_ultimo,sincronizzato_il")
      .eq("mostra_in_app", true)
      .order("codice_articolo", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    rows.push(...(data || []));
    if ((data || []).length < PAGE_SIZE) return rows;
  }
}

export function warehouseRow(row = {}) {
  const onHand = Number(row.giacenza || 0);
  const committed = Number(row.impegnato || 0);
  const available = Number.isFinite(Number(row.disponibilita))
    ? Number(row.disponibilita)
    : onHand - committed;
  const unitCost = Math.max(0, Number(row.costo_ultimo || 0));
  return {
    ...row,
    onHand,
    committed,
    available,
    unitCost,
    stockValue: onHand * unitCost,
    availableValue: available * unitCost,
  };
}

export function warehouseSummary(rows = []) {
  return rows.reduce((summary, raw) => {
    const row = warehouseRow(raw);
    summary.articles += 1;
    if (row.unitCost > 0) summary.valuedArticles += 1;
    if (row.available > 0) summary.availableArticles += 1;
    summary.stockValue += row.stockValue;
    summary.availableValue += row.availableValue;
    if (row.sincronizzato_il && (!summary.lastSync || row.sincronizzato_il > summary.lastSync)) summary.lastSync = row.sincronizzato_il;
    return summary;
  }, { articles: 0, valuedArticles: 0, availableArticles: 0, stockValue: 0, availableValue: 0, lastSync: null });
}
