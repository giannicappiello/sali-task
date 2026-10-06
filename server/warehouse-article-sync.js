import { createHash, randomUUID } from "node:crypto";
import { createProgremesProductionClient } from "./progremes-production-client.js";
import { validateInventorySnapshot } from "./progremes-inventory.js";
import { buildMexalClient, loadFullArticle, mapArticleWarehouseStock, warehouseSnapshotDate } from "./mexal/sync-products.js";

export async function syncWarehouseArticle(db, input, { mes = createProgremesProductionClient(), mexalFactory = buildMexalClient } = {}) {
  const articleCode = String(input.articleCode || "").trim().toUpperCase();
  const warehouse = Number(input.warehouseNumber);
  if (!/^[A-Z0-9][A-Z0-9._/&+ -]{0,79}$/.test(articleCode) || !Number.isSafeInteger(warehouse) || warehouse < 1)
    throw Object.assign(new Error("Articolo o magazzino non valido."), { status: 400 });
  if ([1, 8].includes(warehouse)) {
    const { result } = await mes.syncInventoryArticle({ externalId: randomUUID(), articleCode });
    let snapshot;
    try { snapshot = JSON.parse(result.payload); } catch { /* rejected below */ }
    if (!validateInventorySnapshot(snapshot) || snapshot.rows.some(row => row.article_code !== articleCode) ||
        !/^[0-9a-f-]{36}$/i.test(result.eventId || ""))
      throw Object.assign(new Error("Snapshot giacenze MES non valido."), { status: 502 });
    const { error } = await db.rpc("apply_workspace_mes_inventory", {
      p_event_id: result.eventId, p_captured_at: snapshot.capturedAt,
      p_hash: createHash("sha256").update(result.payload).digest("hex"), p_rows: snapshot.rows,
    });
    if (error) throw Object.assign(new Error("Giacenze MES aggiornate; consegna a Workspace da ritentare automaticamente."), { status: 503 });
    const confirmed = await db.from("workspace_warehouse_stock")
      .select("warehouse_number,on_hand,committed,available,synchronized_at")
      .eq("article_code", articleCode).in("warehouse_number", [1, 8]);
    if (confirmed.error || !snapshot.rows.every(expected => confirmed.data?.some(actual =>
      actual.warehouse_number === expected.warehouse_number &&
      new Date(actual.synchronized_at).getTime() >= new Date(snapshot.capturedAt).getTime() &&
      ["on_hand", "committed", "available"].every(key => Number(actual[key]) === Number(expected[key])))))
      throw Object.assign(new Error("Giacenza MES aggiornata, ma il valore in Workspace non coincide: verificare anagrafica e consegna dello snapshot. Sincronizzazione non confermata."), { status: 503 });
    return { message: "Giacenza di " + articleCode + " sincronizzata in Workspace e MES (magazzini 1 e 8)." };
  }
  // Warehouses outside MES's operational scope retain their existing Mexal source.
  const existing = await db.from("workspace_warehouse_stock").select("warehouse_name")
    .eq("article_code", articleCode).eq("warehouse_number", warehouse).maybeSingle();
  if (existing.error) throw existing.error;
  if (!existing.data) throw Object.assign(new Error("Riga articolo-magazzino non presente."), { status: 400 });
  const client = mexalFactory({ warehouse, timeoutMs: 15000, retryOptions: { maxRetries: 1 } });
  const article = await loadFullArticle(client, articleCode, {});
  const row = mapArticleWarehouseStock(article, { number: warehouse, name: existing.data.warehouse_name });
  if (row.article_code !== articleCode) throw new Error("Mexal ha restituito un articolo diverso da quello richiesto.");
  const current = await db.from("workspace_warehouse_stock").upsert([row], { onConflict: "article_code,warehouse_number" });
  if (current.error) throw current.error;
  const history = await db.from("workspace_warehouse_stock_history").upsert([{
    snapshot_date: warehouseSnapshotDate(row.synchronized_at), article_code: articleCode, warehouse_number: warehouse,
    warehouse_name: row.warehouse_name, unit_of_measure: row.unit_of_measure, on_hand: row.on_hand,
    committed: row.committed, available: row.available, unit_cost: row.unit_cost,
    source: "mexal_progressive", source_payload: row.source_payload, captured_at: row.synchronized_at,
  }], { onConflict: "snapshot_date,article_code,warehouse_number" });
  if (history.error) throw history.error;
  if (warehouse === 5 && /^(IT|MKT)/.test(articleCode)) {
    const cache = await db.from("ordini_prodotti_cache").update({ giacenza: row.on_hand,
      impegnato: row.committed, disponibilita: row.available, costo_ultimo: row.unit_cost,
      unita_misura: row.unit_of_measure, dati_mexal: article, sincronizzato_il: row.synchronized_at })
      .eq("codice_articolo", articleCode);
    if (cache.error) throw cache.error;
    const product = await db.from("prodotti").update({ giacenza: row.on_hand, disponibilita: row.available,
      costo_ultimo: row.unit_cost, ultimo_sync_mexal: row.synchronized_at })
      .eq("codice_mexal", articleCode).eq("sincronizzato_mexal", true);
    if (product.error) throw product.error;
  }
  return { message: "Giacenza di " + articleCode + " sincronizzata nel magazzino " + warehouse + "." };
}
