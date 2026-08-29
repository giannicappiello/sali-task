const PAGE_SIZE = 1000;

export async function loadWorkspaceWarehouse(db) {
  const rows = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await db
      .from("ordini_prodotti_cache")
      .select("codice_articolo,descrizione,unita_misura,giacenza,impegnato,disponibilita,costo_ultimo,sincronizzato_il,dati_mexal")
      .eq("mostra_in_app", true)
      .order("codice_articolo", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    rows.push(...(data || []));
    if ((data || []).length < PAGE_SIZE) break;
  }
  const details = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await db.from("workspace_warehouse_stock")
      .select("article_code,warehouse_number,warehouse_name,unit_of_measure,on_hand,committed,available,unit_cost,synchronized_at")
      .eq("is_current", true).order("article_code", { ascending: true }).order("warehouse_number", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    details.push(...(data || []));
    if ((data || []).length < PAGE_SIZE) break;
  }
  const byArticle = new Map();
  for (const detail of details) {
    const code = String(detail.article_code || "").trim().toUpperCase();
    byArticle.set(code, [...(byArticle.get(code) || []), detail]);
  }
  return rows.map((row) => ({ ...row, warehouse_details: byArticle.get(String(row.codice_articolo || "").trim().toUpperCase()) || [] }));
}

export function warehouseRow(row = {}) {
  const unitCost = Math.max(0, Number(row.unitCost ?? row.costo_ultimo ?? 0));
  const warehouseDetails = (row.warehouse_details || row.warehouseDetails || []).map((detail) => {
    const warehouseNumber = Number(detail.warehouse_number ?? detail.warehouseNumber);
    const onHand = Number(detail.on_hand ?? detail.onHand ?? 0);
    const committed = Number(detail.committed || 0);
    const available = Number.isFinite(Number(detail.available)) ? Number(detail.available) : onHand - committed;
    const detailCost = Math.max(0, Number(detail.unit_cost ?? detail.unitCost ?? unitCost));
    return {
      articleCode: String(row.codice_articolo || detail.article_code || "").trim().toUpperCase(),
      warehouseNumber,
      warehouseName: detail.warehouse_name || detail.warehouseName || null,
      warehouse: `MAG-${warehouseNumber}`,
      unita_misura: detail.unit_of_measure || row.unita_misura,
      onHand,
      committed,
      available,
      unitCost: detailCost,
      stockValue: onHand * detailCost,
      availableValue: available * detailCost,
      sincronizzato_il: detail.synchronized_at || detail.sincronizzato_il || row.sincronizzato_il,
    };
  });
  const onHand = warehouseDetails.length ? warehouseDetails.reduce((sum, detail) => sum + detail.onHand, 0) : Number(row.onHand ?? row.giacenza ?? 0);
  const committed = warehouseDetails.length ? warehouseDetails.reduce((sum, detail) => sum + detail.committed, 0) : Number(row.committed ?? row.impegnato ?? 0);
  const available = warehouseDetails.length ? warehouseDetails.reduce((sum, detail) => sum + detail.available, 0)
    : Number.isFinite(Number(row.available ?? row.disponibilita)) ? Number(row.available ?? row.disponibilita) : onHand - committed;
  const stockValue = warehouseDetails.length ? warehouseDetails.reduce((sum, detail) => sum + detail.stockValue, 0) : onHand * unitCost;
  const availableValue = warehouseDetails.length ? warehouseDetails.reduce((sum, detail) => sum + detail.availableValue, 0) : available * unitCost;
  return {
    ...row,
    onHand,
    committed,
    available,
    unitCost,
    stockValue,
    availableValue,
    warehouseDetails,
    warehouse: warehouseDetails.length > 1 ? "Aggregato" : warehouseDetails[0]?.warehouse || row.warehouse || warehouseLocation(row),
  };
}

function positiveWarehouse(value) {
  const raw = Array.isArray(value) ? value.find((item) => Number(item) > 0) : value;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export function warehouseLocation(row = {}) {
  const source = row.dati_mexal || row.json_mexal || {};
  const number = positiveWarehouse(row.numero_magazzino ?? row.id_magazzino ?? row.magazzino
    ?? source.id_magazzino ?? source.numero_magazzino ?? source.cod_magazzino ?? source.magazzino ?? source.id_mag);
  if (number) return `MAG-${number}`;
  const code = String(row.codice_articolo || row.codice_mexal || row.codice || "").trim().toUpperCase();
  if (code.startsWith("IT") || code.startsWith("MKT")) return "MAG-5";
  return "Aggregato";
}

export function warehouseSummary(rows = []) {
  const articleCodes = new Set();
  const valuedCodes = new Set();
  const availableCodes = new Set();
  const summary = rows.reduce((result, raw) => {
    const row = warehouseRow(raw);
    const code = String(row.codice_articolo || row.articleCode || "").trim().toUpperCase();
    if (code) articleCodes.add(code);
    if (code && row.unitCost > 0) valuedCodes.add(code);
    if (code && row.available > 0) availableCodes.add(code);
    result.stockValue += Math.max(0, row.stockValue);
    result.availableValue += Math.max(0, row.available) * row.unitCost;
    if (row.sincronizzato_il && (!result.lastSync || row.sincronizzato_il > result.lastSync)) result.lastSync = row.sincronizzato_il;
    return result;
  }, { articles: 0, valuedArticles: 0, availableArticles: 0, stockValue: 0, availableValue: 0, lastSync: null });
  return { ...summary, articles: articleCodes.size, valuedArticles: valuedCodes.size, availableArticles: availableCodes.size };
}

export function nonNegativeWarehouseRows(rows = []) {
  return rows.map(warehouseRow).filter((row) => row.onHand >= 0);
}

const ARTICLE_TYPES = ["MKT", "MP", "IT", "CN", "FP", "AS", "TB"];

export function warehouseArticleType(code) {
  const normalized = String(code || "").trim().toUpperCase();
  return ARTICLE_TYPES.find((prefix) => normalized.startsWith(prefix)) || "ALTRI";
}

export function warehouseBreakdown(rows = []) {
  const byType = new Map();
  const byUnit = new Map();
  const byWarehouse = new Map();
  for (const raw of rows) {
    const row = warehouseRow(raw);
    const type = warehouseArticleType(row.codice_articolo);
    const unit = String(row.unita_misura || "SENZA UDM").trim().toUpperCase();
    const articleCode = String(row.codice_articolo || row.articleCode || "").trim().toUpperCase();
    const typeItem = byType.get(type) || { type, articles: 0, articleCodes: new Set(), quantity: 0, available: 0, value: 0, availableValue: 0 };
    typeItem.articleCodes.add(articleCode);
    typeItem.articles = typeItem.articleCodes.size;
    typeItem.quantity += row.onHand;
    typeItem.available += Math.max(0, row.available);
    typeItem.value += Math.max(0, row.stockValue);
    typeItem.availableValue += Math.max(0, row.available) * row.unitCost;
    byType.set(type, typeItem);
    const unitItem = byUnit.get(unit) || { unit, articles: 0, articleCodes: new Set(), quantity: 0, committed: 0, available: 0, value: 0 };
    unitItem.articleCodes.add(articleCode);
    unitItem.articles = unitItem.articleCodes.size;
    unitItem.quantity += row.onHand;
    unitItem.committed += row.committed;
    unitItem.available += Math.max(0, row.available);
    unitItem.value += Math.max(0, row.stockValue);
    byUnit.set(unit, unitItem);
    const warehouseItem = byWarehouse.get(row.warehouse) || { type: row.warehouse, articles: 0, articleCodes: new Set(), quantity: 0, available: 0, value: 0, availableValue: 0 };
    warehouseItem.articleCodes.add(articleCode);
    warehouseItem.articles = warehouseItem.articleCodes.size;
    warehouseItem.quantity += row.onHand;
    warehouseItem.available += Math.max(0, row.available);
    warehouseItem.value += Math.max(0, row.stockValue);
    warehouseItem.availableValue += Math.max(0, row.available) * row.unitCost;
    byWarehouse.set(row.warehouse, warehouseItem);
  }
  const clean = (items) => [...items.values()].map((item) => {
    const { articleCodes: ignoredArticleCodes, ...publicItem } = item;
    void ignoredArticleCodes;
    return publicItem;
  });
  return {
    byType: clean(byType).sort((a, b) => b.value - a.value || a.type.localeCompare(b.type)),
    byUnit: clean(byUnit).sort((a, b) => b.value - a.value || a.unit.localeCompare(b.unit)),
    byWarehouse: clean(byWarehouse).sort((a, b) => b.articles - a.articles || a.type.localeCompare(b.type)),
  };
}

export function warehouseScopedRows(rows = [], selectedWarehouse = "TUTTI") {
  return rows.flatMap((raw) => {
    const row = warehouseRow(raw);
    const details = row.warehouseDetails || [];
    const scoped = details.length ? details.map((detail) => ({
      ...row,
      ...detail,
      codice_articolo: row.codice_articolo,
      descrizione: row.descrizione,
      warehouse_details: [],
      warehouseDetails: [],
    })) : [row];
    return selectedWarehouse === "TUTTI" ? scoped : scoped.filter((item) => item.warehouse === selectedWarehouse);
  });
}
