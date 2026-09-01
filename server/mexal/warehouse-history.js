import { calculateStock, getLastCost, mexalNetAvailability } from "./sync-products.js";

const ARTICLE_FIELDS = [
  "codice", "um_principale", "qta_inventario", "qta_carico", "qta_scarico",
  "ord_fornitori", "ord_produzione", "ord_cli_e", "ord_cli_sps", "ord_cli_auto", "costo_ult",
].join(",");

const text = (value) => String(value ?? "").trim();
const number = (value) => {
  const parsed = Number(text(value).replace(",", "."));
  return Number.isFinite(parsed) ? parsed : 0;
};
const day = (value) => {
  const digits = text(value).replace(/\D/g, "").slice(0, 8);
  return digits.length === 8 ? `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}` : null;
};

function matrix(value) {
  const result = new Map();
  if (!Array.isArray(value)) return result;
  for (const row of value) if (Array.isArray(row) && row.length > 1) result.set(Number(row[0]), row.at(-1));
  return result;
}

export function warehouseMovementLines(detail = {}) {
  const articles = matrix(detail.codice_articolo);
  const quantities = matrix(detail.quantita);
  const types = matrix(detail.tp_riga);
  const from = matrix(detail.id_mag_da_riga);
  const to = matrix(detail.id_mag_a_riga);
  const headerFrom = Number(detail.id_magazzino) || null;
  const headerTo = Number(detail.id_magazzino_a) || null;
  const movementDate = day(detail.data_documento);
  return [...articles.keys()].flatMap((position) => {
    const articleCode = text(articles.get(position)).toUpperCase();
    const quantity = Math.abs(number(quantities.get(position)));
    const lineType = text(types.get(position)).toUpperCase();
    if (!movementDate || !articleCode || !quantity || (lineType && lineType !== "R")) return [];
    const fromWarehouse = Number(from.get(position)) || headerFrom;
    const toWarehouse = Number(to.get(position)) || headerTo;
    if (!fromWarehouse && !toWarehouse) return [];
    return [{ movementDate, articleCode, quantity, fromWarehouse, toWarehouse }];
  });
}

export function reconstructWarehouseSnapshots(currentRows = [], movements = [], dates = []) {
  const latestDate = [...dates].sort().at(-1);
  return [...dates].sort().flatMap((snapshotDate) => currentRows.map((row) => {
    const articleCode = text(row.article_code).toUpperCase();
    const warehouseNumber = Number(row.warehouse_number);
    const laterDelta = movements.reduce((sum, movement) => {
      if (movement.movementDate <= snapshotDate || movement.articleCode !== articleCode) return sum;
      if (movement.fromWarehouse === warehouseNumber) sum -= movement.quantity;
      if (movement.toWarehouse === warehouseNumber) sum += movement.quantity;
      return sum;
    }, 0);
    const historical = snapshotDate !== latestDate;
    const onHand = Math.round((Number(row.on_hand) - laterDelta + Number.EPSILON) * 10000) / 10000;
    return {
      snapshot_date: snapshotDate,
      article_code: articleCode,
      warehouse_number: warehouseNumber,
      warehouse_name: row.warehouse_name || null,
      unit_of_measure: row.unit_of_measure || null,
      on_hand: onHand,
      committed: historical ? null : row.committed,
      available: historical ? null : row.available,
      unit_cost: Math.max(0, Number(row.unit_cost) || 0),
      source: historical ? "mexal_reconstructed" : "mexal_progressive",
      source_payload: historical ? { reconstructed_from: latestDate } : (row.source_payload || {}),
      sync_run_id: null,
      captured_at: row.captured_at,
    };
  }));
}

async function pagedRows(mexal, path, { fields = null, maxPages = 250 } = {}) {
  const result = [];
  const seen = new Set();
  let next = null;
  for (let page = 0; page < maxPages; page += 1) {
    const query = new URLSearchParams({ max: "500" });
    if (fields) query.set("fields", fields);
    if (next) query.set("next", next);
    const payload = await mexal.getJson(`${path}?${query}`);
    const rows = Array.isArray(payload) ? payload : (payload?.dati || payload?.records || payload?.items || payload?.data || []);
    result.push(...rows);
    const candidate = payload?.next ? String(payload.next) : null;
    if (!candidate) return result;
    if (seen.has(candidate)) throw new Error(`Paginazione Mexal ciclica su ${path}.`);
    seen.add(candidate);
    next = candidate;
  }
  throw new Error(`Paginazione Mexal oltre il limite su ${path}.`);
}

export async function loadWarehouseProgressives(mexal, warehouse, activeCodes) {
  const rows = await pagedRows(mexal, "/articoli", { fields: ARTICLE_FIELDS });
  return rows.flatMap((article) => {
    const articleCode = text(article.codice).toUpperCase();
    if (!articleCode || !activeCodes.has(articleCode)) return [];
    const onHand = calculateStock(article);
    const committed = number(article.ord_cli_e) + number(article.ord_cli_sps) + number(article.ord_cli_auto);
    return [{
      article_code: articleCode,
      warehouse_number: warehouse.number,
      warehouse_name: warehouse.name,
      unit_of_measure: text(article.um_principale) || null,
      on_hand: onHand,
      committed,
      available: mexalNetAvailability(article, onHand).value,
      unit_cost: getLastCost(article),
      source_payload: article,
      captured_at: new Date().toISOString(),
    }];
  });
}

export async function loadWarehouseMovements(mexal, minimumDate, maximumDate) {
  const summaries = await pagedRows(mexal, "/documenti/movimenti-magazzino");
  const unique = new Map();
  for (const summary of summaries) {
    const movementDate = day(summary.data_documento);
    if (!movementDate || movementDate <= minimumDate || movementDate > maximumDate) continue;
    const key = [summary.sigla, summary.serie, summary.numero, summary.cod_conto].map(text).join("|");
    unique.set(key, summary);
  }
  const details = [];
  const queue = [...unique.values()];
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(4, queue.length) }, async () => {
    while (cursor < queue.length) {
      const summary = queue[cursor++];
      const path = `/documenti/movimenti-magazzino/${encodeURIComponent(text(summary.sigla))}+${number(summary.serie)}+${number(summary.numero)}+${encodeURIComponent(text(summary.cod_conto))}`;
      details.push(await mexal.getJson(path));
    }
  }));
  return details.flatMap(warehouseMovementLines);
}

export async function upsertWarehouseSnapshots(db, rows, chunkSize = 500) {
  for (let offset = 0; offset < rows.length; offset += chunkSize) {
    const { error } = await db.from("workspace_warehouse_stock_history")
      .upsert(rows.slice(offset, offset + chunkSize), { onConflict: "snapshot_date,article_code,warehouse_number" });
    if (error) throw error;
  }
}
