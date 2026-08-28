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

const ARTICLE_TYPES = ["MP", "IT", "CN", "FP", "AS", "TB"];

export function warehouseArticleType(code) {
  const normalized = String(code || "").trim().toUpperCase();
  return ARTICLE_TYPES.find((prefix) => normalized.startsWith(prefix)) || "ALTRI";
}

export function warehouseBreakdown(rows = []) {
  const byType = new Map();
  const byUnit = new Map();
  for (const raw of rows) {
    const row = warehouseRow(raw);
    const type = warehouseArticleType(row.codice_articolo);
    const unit = String(row.unita_misura || "SENZA UDM").trim().toUpperCase();
    const typeItem = byType.get(type) || { type, articles: 0, quantity: 0, available: 0, value: 0, availableValue: 0 };
    typeItem.articles += 1;
    typeItem.quantity += row.onHand;
    typeItem.available += row.available;
    typeItem.value += row.stockValue;
    typeItem.availableValue += row.availableValue;
    byType.set(type, typeItem);
    const unitItem = byUnit.get(unit) || { unit, articles: 0, quantity: 0, committed: 0, available: 0, value: 0 };
    unitItem.articles += 1;
    unitItem.quantity += row.onHand;
    unitItem.committed += row.committed;
    unitItem.available += row.available;
    unitItem.value += row.stockValue;
    byUnit.set(unit, unitItem);
  }
  return {
    byType: [...byType.values()].sort((a, b) => b.value - a.value || a.type.localeCompare(b.type)),
    byUnit: [...byUnit.values()].sort((a, b) => b.value - a.value || a.unit.localeCompare(b.unit)),
  };
}
