import { buildMexalClient, loadFullArticle, mapArticleWarehouseStock, warehouseSnapshotDate } from "./mexal/sync-products.js";

export async function syncWarehouseArticle(db, input, { mexalFactory = buildMexalClient } = {}) {
  const articleCode = String(input.articleCode || "").trim().toUpperCase();
  const warehouse = Number(input.warehouseNumber);
  if (!/^[A-Z0-9][A-Z0-9._/&+ -]{0,79}$/.test(articleCode) || !Number.isSafeInteger(warehouse) || warehouse < 1)
    throw Object.assign(new Error("Articolo o magazzino non valido."), { status: 400 });
  if ([1, 8].includes(warehouse)) {
    const existing = await db.from("workspace_warehouse_stock").select("warehouse_number,warehouse_name")
      .eq("article_code", articleCode).in("warehouse_number", [1, 8]);
    if (existing.error) throw existing.error;
    if (!existing.data?.some(row => row.warehouse_number === warehouse))
      throw Object.assign(new Error("Riga articolo-magazzino non presente."), { status: 400 });
    const capturedAt = new Date().toISOString();
    // Read just this article directly from Mexal in both operational warehouses.
    // No write happens until both responses have been validated.
    const rows = await Promise.all([1, 8].map(async number => {
      const client = mexalFactory({ warehouse: number, timeoutMs: 15000, retryOptions: { maxRetries: 1 } });
      const article = await loadFullArticle(client, articleCode, {});
      const fields = ["qta_inventario", "qta_carico", "qta_scarico"];
      if (!fields.some(field => article[field] != null))
        throw Object.assign(new Error(`Mexal non restituisce progressivi per ${articleCode}, magazzino ${number}. Giacenze precedenti conservate.`), { status: 502 });
      for (const field of fields) {
        const value = article[field];
        if (value == null) continue; // Mexal can omit a zero progressive.
        if (String(value).trim() === "" || !Number.isFinite(Number(String(value).replace(",", "."))))
          throw Object.assign(new Error(`Mexal non restituisce ${field} per ${articleCode}, magazzino ${number}. Giacenze precedenti conservate.`), { status: 502 });
      }
      const row = mapArticleWarehouseStock(article, { number,
        name: existing.data.find(x => x.warehouse_number === number)?.warehouse_name ||
          (number === 1 ? "Magazzino 1 Progrè" : "Magazzino c/Terzi") }, { synchronizedAt: capturedAt });
      if (row.article_code !== articleCode)
        throw Object.assign(new Error("Mexal ha restituito un articolo diverso da quello richiesto."), { status: 502 });
      row.source_payload = { ...article, source_system: "Mexal" };
      return row;
    }));
    const applied = await db.rpc("apply_workspace_mexal_article_stock", {
      p_article_code: articleCode, p_captured_at: capturedAt, p_rows: rows,
    });
    if (applied.error) throw Object.assign(new Error("Aggiornamento giacenza Workspace non completato: " + applied.error.message), { status: 503 });
    if (applied.data?.superseded) return { message: "Giacenza di " + articleCode + " già aggiornata da una lettura Mexal più recente." };
    const confirmed = await db.from("workspace_warehouse_stock")
      .select("warehouse_number,on_hand,committed,available,synchronized_at")
      .eq("article_code", articleCode).in("warehouse_number", [1, 8]);
    if (confirmed.error || !rows.every(expected => confirmed.data?.some(actual =>
      actual.warehouse_number === expected.warehouse_number &&
      new Date(actual.synchronized_at).getTime() >= new Date(capturedAt).getTime() &&
      ["on_hand", "committed", "available"].every(key => Number(actual[key]) === Number(expected[key])))))
      throw Object.assign(new Error("Giacenza letta da Mexal ma salvataggio Workspace non confermato. Riprova l'aggiornamento del solo articolo."), { status: 503 });
    return { message: "Giacenza di " + articleCode + " aggiornata direttamente da Mexal in Workspace (magazzini 1 e 8)." };
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
