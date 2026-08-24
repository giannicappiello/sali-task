import { createHash } from "node:crypto";

const QUANTITY_SCALE = 6;
const STOCK_WAREHOUSE = 5;

function text(value) { return String(value ?? "").trim(); }
function upper(value) { return text(value).toUpperCase(); }
function finite(value, label) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw Object.assign(new Error(`${label} non valida.`), { code: "INVALID_QUANTITY" });
  return parsed;
}
function quantity(value, label) {
  const parsed = finite(value, label);
  if (parsed < 0) throw Object.assign(new Error(`${label} non può essere negativa.`), { code: "NEGATIVE_QUANTITY" });
  return Math.round(parsed * (10 ** QUANTITY_SCALE)) / (10 ** QUANTITY_SCALE);
}
function hash(value) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }

export function normalizeUnitOfMeasure(value) {
  return upper(value).replaceAll(".", "").replace(/\s+/g, " ");
}

export function finishedProductWarehouseRule(articleCode) {
  const code = upper(articleCode);
  const warehouse5Only = code.startsWith("IT") || code.startsWith("MKT");
  return warehouse5Only
    ? { code: "WAREHOUSE_5_ONLY", warehouses: [STOCK_WAREHOUSE], description: "Articoli IT/MKT: disponibilità Mexal del solo magazzino 5." }
    : { code: "ALL_WAREHOUSES", warehouses: null, description: "Altri articoli: disponibilità Mexal aggregata su tutti i magazzini." };
}

function explicitConversion(conversions, from, to) {
  return (conversions || []).find((item) => item?.active !== false &&
    normalizeUnitOfMeasure(item?.from) === from && normalizeUnitOfMeasure(item?.to) === to);
}

export function calculateProductionNetting({
  requestedQuantity,
  availableQuantity,
  lineUnitOfMeasure,
  productUnitOfMeasure,
  conversions = [],
}) {
  const requested = quantity(requestedQuantity, "Quantità OCT");
  const available = quantity(Math.max(0, finite(availableQuantity ?? 0, "Disponibilità prodotto")), "Disponibilità prodotto");
  const lineUom = normalizeUnitOfMeasure(lineUnitOfMeasure);
  const productUom = normalizeUnitOfMeasure(productUnitOfMeasure);
  if (!productUom) throw Object.assign(new Error("UDM dell'articolo non disponibile."), { code: "PRODUCT_UOM_MISSING" });

  let requestedInProductUom = requested;
  let conversion = null;
  if (lineUom && lineUom !== productUom) {
    conversion = explicitConversion(conversions, lineUom, productUom);
    const factor = Number(conversion?.factor);
    if (!conversion || !Number.isFinite(factor) || factor <= 0) {
      throw Object.assign(new Error(`UDM OCT ${lineUom} non compatibile con UDM articolo ${productUom}.`), {
        code: "UOM_MISMATCH",
        lineUnitOfMeasure: lineUom,
        productUnitOfMeasure: productUom,
      });
    }
    requestedInProductUom = quantity(requested * factor, "Quantità OCT convertita");
  }

  const covered = quantity(Math.min(requestedInProductUom, available), "Quantità coperta");
  const toProduce = quantity(Math.max(0, requestedInProductUom - covered), "Quantità da produrre");
  return {
    requestedQuantity: requested,
    requestedQuantityInProductUom: requestedInProductUom,
    availableQuantity: available,
    coveredQuantity: covered,
    quantityToProduce: toProduce,
    fullyCovered: toProduce === 0,
    lineUnitOfMeasure: lineUom || null,
    productUnitOfMeasure: productUom,
    effectiveUnitOfMeasure: productUom,
    unitSource: lineUom ? "OCT" : "PRODUCT_FALLBACK",
    conversion: conversion ? {
      from: lineUom,
      to: productUom,
      factor: Number(conversion.factor),
      source: text(conversion.source) || "EXPLICIT",
    } : null,
  };
}

function single(query) { return query.single(); }

async function loadProductionSources(admin, lineId) {
  const { data: line, error: lineError } = await single(admin.from("ordini_righe").select("*").eq("id", lineId));
  if (lineError || !line || line.riga_descrittiva || !text(line.codice_articolo) || Number(line.quantita) <= 0)
    throw Object.assign(new Error("Riga OCT non produttiva."), { code: "INVALID_OCT_LINE", status: 400 });
  const { data: order, error: orderError } = await single(admin.from("ordini_testate").select("*").eq("id", line.ordine_id));
  if (orderError || order?.origine !== "mexal_oct")
    throw Object.assign(new Error("La riga non appartiene a un OCT."), { code: "INVALID_OCT", status: 400 });
  const code = upper(line.codice_articolo);
  const { data: product, error: productError } = await single(admin.from("prodotti")
    .select("id,codice_mexal,disponibilita,ultimo_sync_mexal,updated_at,sincronizzato_mexal,attivo_mexal")
    .eq("codice_mexal", code).eq("sincronizzato_mexal", true).eq("attivo_mexal", true));
  if (productError || !product)
    throw Object.assign(new Error(`Articolo ${code} non disponibile nell'anagrafica Mexal sincronizzata.`), { code: "PRODUCT_NOT_AVAILABLE", status: 409 });
  const { data: catalog, error: catalogError } = await admin.from("ordini_prodotti_cache")
    .select("codice_articolo,unita_misura,sincronizzato_il").eq("codice_articolo", code).maybeSingle();
  if (catalogError) throw catalogError;
  return { line, order, product, catalog, code };
}

export async function prepareProductionNetting({ admin, lineId, mode = "preview", conversions = [], expectedSnapshotId = null }) {
  if (!admin || !text(lineId)) throw new TypeError("Dipendenze nettificazione non valide.");
  const source = await loadProductionSources(admin, text(lineId));
  const netting = calculateProductionNetting({
    requestedQuantity: source.line.quantita,
    availableQuantity: source.product.disponibilita,
    lineUnitOfMeasure: source.line.unita_misura_oct,
    productUnitOfMeasure: source.catalog?.unita_misura,
    conversions,
  });
  const warehouseRule = finishedProductWarehouseRule(source.code);
  const capturedAt = new Date().toISOString();
  const snapshot = {
    version: 1,
    mode,
    orderId: source.order.id,
    lineId: source.line.id,
    mexalOrderKey: source.order.mexal_chiave,
    articleCode: source.code,
    ...netting,
    warehouseRule,
    productAvailabilityUpdatedAt: source.product.updated_at,
    productLastMexalSyncAt: source.product.ultimo_sync_mexal,
    productCatalogSyncedAt: source.catalog?.sincronizzato_il || null,
    capturedAt,
  };
  const snapshotHash = hash({ ...snapshot, capturedAt: undefined, mode: undefined });
  const { data, error } = await admin.rpc("record_workspace_production_netting", {
    p_ordine_id: source.order.id,
    p_ordine_riga_id: source.line.id,
    p_codice_articolo: source.code,
    p_quantita_richiesta_oct: netting.requestedQuantity,
    p_quantita_richiesta_prodotto: netting.requestedQuantityInProductUom,
    p_quantita_disponibile: netting.availableQuantity,
    p_quantita_coperta: netting.coveredQuantity,
    p_quantita_da_produrre: netting.quantityToProduce,
    p_udm_oct: netting.lineUnitOfMeasure,
    p_udm_prodotto: netting.productUnitOfMeasure,
    p_udm_effettiva: netting.effectiveUnitOfMeasure,
    p_conversione: netting.conversion,
    p_regola_magazzini: warehouseRule,
    p_product_updated_at: source.product.updated_at,
    p_product_last_sync_at: source.product.ultimo_sync_mexal,
    p_snapshot_hash: snapshotHash,
    p_snapshot: snapshot,
  });
  if (error) {
    const conflict = /AVAILABILITY_CHANGED/i.test(error.message || "");
    throw Object.assign(new Error(conflict ? "La disponibilità è cambiata durante la nettificazione; ripetere la preview." : error.message), {
      code: conflict ? "AVAILABILITY_CHANGED" : "NETTING_PERSIST_FAILED",
      status: conflict ? 409 : 500,
    });
  }
  const recorded = Array.isArray(data) ? data[0] : data;
  if (!recorded?.request_id || !recorded?.snapshot_id) throw new Error("Snapshot nettificazione non confermata dal database.");
  const changedFromExpected = expectedSnapshotId !== null && Number(expectedSnapshotId) !== Number(recorded.snapshot_id);
  return {
    request: { id: recorded.request_id, external_id: recorded.external_id, attempt_count: Number(recorded.attempt_count || 0) },
    snapshot: { ...snapshot, capturedAt: recorded.snapshot_captured_at || capturedAt,
      id: Number(recorded.snapshot_id), hash: snapshotHash, reused: recorded.reused === true },
    netting,
    changedFromExpected,
    source: { line: source.line, order: source.order },
  };
}

export function productionNettingContract(netting) {
  return {
    requested: { value: netting.requestedQuantity, unitOfMeasure: netting.lineUnitOfMeasure || netting.productUnitOfMeasure },
    requestedInProductionUnit: { value: netting.requestedQuantityInProductUom, unitOfMeasure: netting.productUnitOfMeasure },
    availableFinishedProduct: { value: netting.availableQuantity, unitOfMeasure: netting.productUnitOfMeasure },
    coveredFromStock: { value: netting.coveredQuantity, unitOfMeasure: netting.productUnitOfMeasure },
    toProduce: { value: netting.quantityToProduce, unitOfMeasure: netting.productUnitOfMeasure },
    conversion: netting.conversion,
  };
}
