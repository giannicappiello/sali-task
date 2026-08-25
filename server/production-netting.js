import { createHash } from "node:crypto";

const QUANTITY_SCALE = 6;
const CONTRACT_VERSION = 2;

function text(value) { return String(value ?? "").trim(); }
function upper(value) { return text(value).toUpperCase(); }
function unique(values) { return [...new Set((values || []).map(text).filter(Boolean))]; }
function finiteQuantity(value, label) {
  if (value === null || value === undefined || text(value) === "")
    throw Object.assign(new Error(`${label} non disponibile.`), { code: "QUANTITY_MISSING", status: 409 });
  const parsed = Number(value);
  if (!Number.isFinite(parsed))
    throw Object.assign(new Error(`${label} non valida.`), { code: "INVALID_QUANTITY", status: 409 });
  if (parsed <= 0)
    throw Object.assign(new Error(`${label} deve essere maggiore di zero.`), { code: "INVALID_QUANTITY", status: 409 });
  return Math.round(parsed * (10 ** QUANTITY_SCALE)) / (10 ** QUANTITY_SCALE);
}
function hash(value) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }

export function normalizeUnitOfMeasure(value) {
  return upper(value).replaceAll(".", "").replace(/\s+/g, " ");
}

function explicitConversion(conversions, from, to) {
  return (conversions || []).find((item) => item?.active !== false &&
    normalizeUnitOfMeasure(item?.from) === from && normalizeUnitOfMeasure(item?.to) === to);
}

export function prepareDemandQuantity({ requestedQuantity, lineUnitOfMeasure, productUnitOfMeasure, conversions = [] }) {
  const requested = finiteQuantity(requestedQuantity, "Quantità OCT");
  const lineUom = normalizeUnitOfMeasure(lineUnitOfMeasure);
  const productUom = normalizeUnitOfMeasure(productUnitOfMeasure);
  if (!lineUom)
    throw Object.assign(new Error("UDM della riga OCT non disponibile."), { code: "OCT_UOM_MISSING", status: 409 });
  if (!productUom)
    throw Object.assign(new Error("UDM dell'articolo non disponibile."), { code: "PRODUCT_UOM_MISSING", status: 409 });

  let productionQuantity = requested;
  let conversion = null;
  if (lineUom !== productUom) {
    conversion = explicitConversion(conversions, lineUom, productUom);
    const factor = Number(conversion?.factor);
    if (!conversion || !Number.isFinite(factor) || factor <= 0) {
      throw Object.assign(new Error(`UDM OCT ${lineUom} non compatibile con UDM articolo ${productUom}.`), {
        code: "UOM_MISMATCH",
        status: 409,
        lineUnitOfMeasure: lineUom,
        productUnitOfMeasure: productUom,
      });
    }
    productionQuantity = finiteQuantity(requested * factor, "Quantità OCT convertita");
  }

  return {
    requestedQuantity: requested,
    requestedUnitOfMeasure: lineUom,
    productionQuantity,
    productionUnitOfMeasure: productUom,
    conversion: conversion ? {
      from: lineUom,
      to: productUom,
      factor: Number(conversion.factor),
      source: text(conversion.source) || "EXPLICIT",
    } : null,
  };
}

async function loadLines(admin, { orderIds, lineIds }) {
  const selectedOrderIds = unique(orderIds);
  const selectedLineIds = unique(lineIds);
  if (!selectedOrderIds.length && !selectedLineIds.length)
    throw Object.assign(new Error("Selezionare almeno un OCT o una riga OCT."), { code: "EMPTY_SELECTION", status: 400 });

  let lineQuery = admin.from("ordini_righe").select("*");
  lineQuery = selectedLineIds.length
    ? lineQuery.in("id", selectedLineIds)
    : lineQuery.in("ordine_id", selectedOrderIds);
  const { data: rawLines, error: lineError } = await lineQuery;
  if (lineError) throw lineError;

  const productiveLines = (rawLines || []).filter((line) =>
    !line.riga_descrittiva && text(line.codice_articolo) && Number(line.quantita) > 0);
  if (!productiveLines.length)
    throw Object.assign(new Error("La selezione non contiene righe OCT produttive."), { code: "NO_PRODUCTIVE_LINES", status: 400 });
  const productiveOrderIds = new Set(productiveLines.map((line) => text(line.ordine_id)));
  if (selectedOrderIds.some((id) => !productiveOrderIds.has(id)))
    throw Object.assign(new Error("Uno o più OCT selezionati non contengono righe produttive valide."), { code: "OCT_WITHOUT_PRODUCTIVE_LINES", status: 409 });
  if (selectedLineIds.length && productiveLines.length !== selectedLineIds.length)
    throw Object.assign(new Error("Una o più righe selezionate non sono righe OCT produttive."), { code: "INVALID_OCT_LINE", status: 400 });

  const sourceOrderIds = unique(productiveLines.map((line) => line.ordine_id));
  const { data: rawOrders, error: orderError } = await admin.from("ordini_testate").select("*").in("id", sourceOrderIds);
  if (orderError) throw orderError;
  const orders = rawOrders || [];
  if (orders.length !== sourceOrderIds.length || orders.some((order) => order.origine !== "mexal_oct"))
    throw Object.assign(new Error("La selezione contiene righe che non appartengono a OCT Mexal."), { code: "INVALID_OCT", status: 400 });

  const orderRank = new Map((selectedOrderIds.length ? selectedOrderIds : sourceOrderIds).map((id, index) => [id, index]));
  const lineRank = new Map(selectedLineIds.map((id, index) => [id, index]));
  productiveLines.sort((left, right) => selectedLineIds.length
    ? (lineRank.get(left.id) - lineRank.get(right.id))
    : ((orderRank.get(left.ordine_id) - orderRank.get(right.ordine_id)) ||
      (Number(left.mexal_posizione || 0) - Number(right.mexal_posizione || 0)) || text(left.id).localeCompare(text(right.id))));
  const orderById = new Map(orders.map((order) => [text(order.id), order]));
  return { lines: productiveLines, orderById };
}

async function loadProductUnit(admin, code) {
  const { data, error } = await admin.from("ordini_prodotti_cache")
    .select("codice_articolo,unita_misura,sincronizzato_il")
    .eq("codice_articolo", code)
    .maybeSingle();
  if (error) throw error;
  if (!data)
    throw Object.assign(new Error(`Articolo ${code} non disponibile nell'anagrafica Mexal sincronizzata.`), {
      code: "PRODUCT_NOT_AVAILABLE",
      status: 409,
    });
  return data;
}

function orderIdentity(order) {
  return {
    orderId: order.id,
    mexalKey: order.mexal_chiave,
    sigla: order.mexal_sigla,
    serie: order.mexal_serie,
    numero: order.mexal_numero,
    customerTechnicalReference: order.mexal_cod_conto || order.codice_cliente || null,
    orderDate: order.data_ordine,
    requestedDeliveryDate: order.data_consegna || null,
  };
}

export async function buildProductionDemand({ admin, orderIds = [], lineIds = [], conversions = [] }) {
  if (!admin) throw new TypeError("Client amministrativo obbligatorio.");
  const { lines, orderById } = await loadLines(admin, { orderIds, lineIds });
  const catalogs = new Map();
  const items = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const code = upper(line.codice_articolo);
    if (!catalogs.has(code)) catalogs.set(code, await loadProductUnit(admin, code));
    const quantity = prepareDemandQuantity({
      requestedQuantity: line.quantita,
      lineUnitOfMeasure: line.unita_misura_oct,
      productUnitOfMeasure: catalogs.get(code)?.unita_misura,
      conversions,
    });
    const order = orderById.get(text(line.ordine_id));
    items.push({
      itemIndex: index + 1,
      itemExternalKey: `${order.mexal_chiave}:${line.mexal_posizione ?? line.id}`,
      orderId: order.id,
      lineId: line.id,
      mexalOrderKey: order.mexal_chiave,
      mexalLinePosition: line.mexal_posizione ?? null,
      commercialArticleCode: code,
      productionArticleCode: null,
      mappingStatus: "TO_RESOLVE_IN_MES",
      requestedQuantity: quantity.requestedQuantity,
      requestedUnitOfMeasure: quantity.requestedUnitOfMeasure,
      productionQuantity: quantity.productionQuantity,
      productionUnitOfMeasure: quantity.productionUnitOfMeasure,
      conversion: quantity.conversion,
      requestedDeliveryDate: line.data_consegna || order.data_consegna || null,
    });
  }
  const orderIdsInDemand = unique(items.map((item) => item.orderId));
  const orders = orderIdsInDemand.map((id) => orderIdentity(orderById.get(id)));
  return { contractVersion: CONTRACT_VERSION, orders, items };
}

export function productionDemandContract(demand) {
  return {
    contractVersion: demand.contractVersion,
    orderCount: demand.orders.length,
    itemCount: demand.items.length,
    orders: demand.orders,
    items: demand.items.map((item) => ({
      ...item,
      workspaceAvailabilityAuthoritative: false,
      nettingOwner: "PROGREMES",
    })),
  };
}

export async function prepareProductionDemand({
  admin,
  orderIds = [],
  lineIds = [],
  mode = "preview",
  conversions = [],
  expectedSnapshotId = null,
  requestedBy = null,
}) {
  const demand = await buildProductionDemand({ admin, orderIds, lineIds, conversions });
  const capturedAt = new Date().toISOString();
  const stableDemand = productionDemandContract(demand);
  const demandHash = hash(stableDemand);
  const selectedOrderIds = unique(orderIds);
  const selectionIdentity = selectedOrderIds.length
    ? { kind: "orders", ids: [...selectedOrderIds].sort() }
    : { kind: "lines", ids: [...demand.items.map((item) => item.lineId)].sort() };
  const idempotencyKey = `rdp:v2:${hash(selectionIdentity)}`;
  const snapshot = {
    version: 2,
    kind: "MULTI_OCT_PRODUCTION_DEMAND",
    requestedBy: requestedBy || null,
    ...stableDemand,
    sources: { orders: "MEXAL_OCT", unitsOfMeasure: "MEXAL_OCT_AND_PRODUCT_CACHE" },
    availability: { authoritative: false, included: false, owner: "PROGREMES" },
    capturedAt,
  };
  const snapshotHash = hash({ ...snapshot, capturedAt: undefined });
  const { data, error } = await admin.rpc("record_workspace_production_demand", {
    p_create_request: mode !== "preview",
    p_idempotency_key: idempotencyKey,
    p_demand_hash: demandHash,
    p_snapshot_hash: snapshotHash,
    p_snapshot: snapshot,
    p_requested_by: requestedBy || null,
  });
  if (error) {
    const conflict = /IDEMPOTENCY_CONFLICT/i.test(error.message || "");
    throw Object.assign(new Error(conflict
      ? "La stessa selezione OCT è già associata a una RdP con contenuto differente."
      : error.message), {
      code: conflict ? "IDEMPOTENCY_CONFLICT" : "DEMAND_PERSIST_FAILED",
      status: conflict ? 409 : 500,
    });
  }
  const recorded = Array.isArray(data) ? data[0] : data;
  if (!recorded?.snapshot_id || (mode !== "preview" && !recorded?.request_id))
    throw new Error("Snapshot della domanda non confermato dal database.");
  const changedFromExpected = expectedSnapshotId !== null && Number(expectedSnapshotId) !== Number(recorded.snapshot_id);
  return {
    request: recorded.request_id ? {
      id: recorded.request_id,
      external_id: recorded.external_id,
      attempt_count: Number(recorded.attempt_count || 0),
      idempotency_key: idempotencyKey,
    } : null,
    snapshot: {
      ...snapshot,
      id: Number(recorded.snapshot_id),
      hash: recorded.snapshot_hash || snapshotHash,
      capturedAt: recorded.snapshot_captured_at || capturedAt,
      reused: recorded.reused === true,
    },
    demand,
    changedFromExpected,
  };
}

export { CONTRACT_VERSION };
