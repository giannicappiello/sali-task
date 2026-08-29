import { createHash, randomBytes } from "node:crypto";
import { authoritativeArticleUnit, resolveOctUnitOfMeasure } from "./mexal/unit-of-measure.js";

const QUANTITY_SCALE = 6;
const CONTRACT_VERSION = 4;

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

async function expectedRequestGeneration(admin, expectedSnapshotId) {
  if (expectedSnapshotId === null || expectedSnapshotId === undefined)
    throw Object.assign(new Error("Creare una nuova anteprima prima dell'invio RdP."), { code: "RDP_PREVIEW_REQUIRED", status: 409 });
  const { data, error } = await admin.from("workspace_production_demand_snapshots")
    .select("id,snapshot")
    .eq("id", expectedSnapshotId)
    .maybeSingle();
  if (error) throw Object.assign(new Error("Anteprima RdP non verificabile."), { code: "RDP_PREVIEW_LOOKUP_FAILED", status: 500, cause: error });
  const generation = text(data?.snapshot?.requestGeneration);
  if (!/^[0-9a-f]{32}$/.test(generation))
    throw Object.assign(new Error("L'anteprima appartiene a una versione precedente. Crearne una nuova."), { code: "RDP_PREVIEW_REFRESH_REQUIRED", status: 409 });
  return generation;
}

async function matchesExpectedSnapshot(admin, {
  expectedSnapshotId,
  recordedSnapshotId,
  recordedSnapshotHash,
  demandHash,
}) {
  if (expectedSnapshotId === null || expectedSnapshotId === undefined) return true;
  if (Number(expectedSnapshotId) === Number(recordedSnapshotId)) return true;
  const { data, error } = await admin.from("workspace_production_demand_snapshots")
    .select("id,snapshot_hash,demand_hash")
    .eq("id", expectedSnapshotId)
    .maybeSingle();
  if (error) {
    throw Object.assign(new Error("Snapshot di anteprima non verificabile."), {
      code: "DEMAND_SNAPSHOT_LOOKUP_FAILED",
      status: 500,
      cause: error,
    });
  }
  return Boolean(data &&
    text(data.snapshot_hash) === text(recordedSnapshotHash) &&
    text(data.demand_hash) === text(demandHash));
}

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
    line.mexal_attiva !== false && !line.riga_descrittiva && text(line.codice_articolo) && Number(line.quantita) > 0);
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
  if (orders.some((order) => !text(order.mexal_cod_conto || order.codice_cliente)))
    throw Object.assign(new Error("Uno o più OCT non hanno un riferimento cliente valido."), { code: "OCT_CUSTOMER_MISSING", status: 409 });
  if (orders.some((order) => !text(order.data_ordine)))
    throw Object.assign(new Error("Uno o più OCT non hanno una data ordine valida."), { code: "OCT_ORDER_DATE_MISSING", status: 409 });
  if (orders.some((order) => !text(order.updated_at || order.created_at || order.mexal_sincronizzato_il)))
    throw Object.assign(new Error("Uno o più OCT non hanno un timestamp sorgente auditabile."), { code: "OCT_SOURCE_TIMESTAMP_MISSING", status: 409 });

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
    .select("codice_articolo,unita_misura,sincronizzato_il,dati_mexal")
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
    sourceTimestamp: order.updated_at || order.created_at || order.mexal_sincronizzato_il || null,
  };
}

export function octVersionHash(order, items) {
  return hash({
    mexalKey: order.mexalKey,
    sigla: order.sigla,
    serie: order.serie,
    numero: order.numero,
    customerTechnicalReference: order.customerTechnicalReference,
    orderDate: order.orderDate,
    requestedDeliveryDate: order.requestedDeliveryDate,
    lines: items.map((item) => ({
      lineId: item.lineId,
      position: item.mexalLinePosition,
      articleCode: item.commercialArticleCode,
      quantity: item.requestedQuantity,
      octUnit: item.requestedUnitOfMeasure,
      articleUnit: item.productionUnitOfMeasure,
      conversion: item.conversion,
      requestedDeliveryDate: item.requestedDeliveryDate,
    })),
  });
}

async function reserveOctRevisions(admin, demand, commit) {
  const octs = demand.orders.map((order) => ({
    orderId: order.orderId,
    versionHash: order.versionHash,
    sourceTimestamp: order.sourceTimestamp,
  }));
  const { data, error } = await admin.rpc("reserve_workspace_oct_contract_revisions", {
    p_octs: octs,
    p_commit: commit,
  });
  if (error) throw Object.assign(new Error(error.message), { code: "OCT_REVISION_RESERVATION_FAILED", status: 500 });
  const rows = Array.isArray(data) ? data : [];
  if (rows.length !== demand.orders.length)
    throw Object.assign(new Error("Revisioni OCT non confermate dal database."), { code: "OCT_REVISION_RESERVATION_FAILED", status: 500 });
  const byOrder = new Map(rows.map((row) => [text(row.order_id), row]));
  return {
    ...demand,
    orders: demand.orders.map((order) => {
      const revision = byOrder.get(text(order.orderId));
      if (!revision || Number(revision.commercial_revision) <= 0)
        throw Object.assign(new Error("Revisione OCT non valida."), { code: "OCT_REVISION_RESERVATION_FAILED", status: 500 });
      return {
        ...order,
        commercialRevision: Number(revision.commercial_revision),
        sourceTimestamp: revision.source_timestamp || order.sourceTimestamp,
      };
    }),
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
    const product = catalogs.get(code);
    const productUnitOfMeasure = authoritativeArticleUnit(product) || authoritativeArticleUnit(product?.dati_mexal);
    const resolvedOctUnit = resolveOctUnitOfMeasure({
      explicitUnit: line.unita_misura_oct,
      mexalUnitType: line.tipo_unita_misura_mexal,
      article: { unita_misura: productUnitOfMeasure },
    });
    const quantity = prepareDemandQuantity({
      requestedQuantity: line.quantita,
      lineUnitOfMeasure: resolvedOctUnit.unit,
      productUnitOfMeasure,
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
      requestedUnitSource: resolvedOctUnit.source,
      productionQuantity: quantity.productionQuantity,
      productionUnitOfMeasure: quantity.productionUnitOfMeasure,
      conversion: quantity.conversion,
      requestedDeliveryDate: line.data_consegna || order.data_consegna || null,
    });
  }
  const canonicalItems = items
    .sort((left, right) => text(left.orderId).localeCompare(text(right.orderId)) ||
      (Number(left.mexalLinePosition ?? Number.MAX_SAFE_INTEGER) - Number(right.mexalLinePosition ?? Number.MAX_SAFE_INTEGER)) ||
      text(left.lineId).localeCompare(text(right.lineId)))
    .map((item, index) => ({ ...item, itemIndex: index + 1 }));
  const orderIdsInDemand = unique(canonicalItems.map((item) => item.orderId));
  const orders = orderIdsInDemand.map((id) => {
    const order = orderIdentity(orderById.get(id));
    return { ...order, versionHash: octVersionHash(order, canonicalItems.filter((item) => item.orderId === id)) };
  });
  return { contractVersion: CONTRACT_VERSION, orders, items: canonicalItems };
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
  generateRequestGeneration = () => randomBytes(16).toString("hex"),
}) {
  const builtDemand = await buildProductionDemand({ admin, orderIds, lineIds, conversions });
  const demand = await reserveOctRevisions(admin, builtDemand, mode !== "preview");
  const capturedAt = new Date().toISOString();
  const stableDemand = productionDemandContract(demand);
  const demandHash = hash(stableDemand);
  const selectedOrderIds = unique(orderIds);
  const selectionIdentity = selectedOrderIds.length
    ? { kind: "orders", ids: [...selectedOrderIds].sort() }
    : { kind: "lines", ids: [...demand.items.map((item) => item.lineId)].sort() };
  const baseIdempotencyKey = `rdp:v4:${hash({
    selectionIdentity,
    revisions: demand.orders.map((order) => ({
      orderId: order.orderId,
      commercialRevision: order.commercialRevision,
      versionHash: order.versionHash,
    })).sort((left, right) => text(left.orderId).localeCompare(text(right.orderId))),
  })}`;
  const requestGeneration = mode === "preview"
    ? text(generateRequestGeneration())
    : await expectedRequestGeneration(admin, expectedSnapshotId);
  if (!/^[0-9a-f]{32}$/.test(requestGeneration))
    throw Object.assign(new Error("Generazione RdP non valida."), { code: "INVALID_RDP_GENERATION", status: 500 });
  const idempotencyKey = `${baseIdempotencyKey}:r${requestGeneration}`;
  const snapshot = {
    version: 4,
    kind: "MULTI_OCT_PRODUCTION_DEMAND",
    requestGeneration,
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
  const recordedSnapshotHash = recorded.snapshot_hash || snapshotHash;
  const changedFromExpected = !await matchesExpectedSnapshot(admin, {
    expectedSnapshotId,
    recordedSnapshotId: recorded.snapshot_id,
    recordedSnapshotHash,
    demandHash,
  });
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
      hash: recordedSnapshotHash,
      capturedAt: recorded.snapshot_captured_at || capturedAt,
      reused: recorded.reused === true,
    },
    demand,
    changedFromExpected,
  };
}

export { CONTRACT_VERSION };
