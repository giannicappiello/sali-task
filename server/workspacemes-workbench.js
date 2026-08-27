import { authoritativeArticleUnit, resolveOctUnitOfMeasure } from "./mexal/unit-of-measure.js";
import { evaluateProductionRequestCancellation } from "./workspacemes-rdp-cancellation.js";

function text(value) { return String(value ?? "").trim(); }
function number(value) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : 0; }

export function resolveWorkbenchOctUnit(line, product) {
  const productUnit = authoritativeArticleUnit(product) || authoritativeArticleUnit(product?.dati_mexal);
  return resolveOctUnitOfMeasure({
    explicitUnit: line?.unita_misura_oct,
    mexalUnitType: line?.tipo_unita_misura_mexal,
    article: { unita_misura: productUnit },
  }).unit;
}

export function resolveWorkbenchUnits(lines, productsByCode) {
  return [...new Set((lines || []).map((line) => resolveWorkbenchOctUnit(
    line,
    productsByCode.get(text(line.codice_articolo).toUpperCase()),
  )).filter(Boolean))];
}

function octLabel(order) {
  return [text(order.mexal_sigla), text(order.mexal_serie), text(order.mexal_numero)].filter(Boolean).join("/");
}

function customerCode(order) {
  return text(order.mexal_cod_conto || order.codice_cliente);
}

function customerName(order, customersByCode) {
  const code = customerCode(order);
  return text(order.ragione_sociale_cliente || customersByCode.get(code)?.ragione_sociale) || code || "—";
}

async function loadCustomers(admin, orders) {
  const codes = [...new Set((orders || []).map(customerCode).filter(Boolean))];
  if (!codes.length) return new Map();
  const result = await admin.from("ordini_clienti_cache").select("codice_cliente,ragione_sociale").in("codice_cliente", codes);
  if (result.error) throw result.error;
  return new Map((result.data || []).map((row) => [text(row.codice_cliente), row]));
}

async function loadProductsByCode(admin, lines) {
  const codes = [...new Set((lines || []).map((line) => text(line.codice_articolo).toUpperCase()).filter(Boolean))];
  if (!codes.length) return new Map();
  const result = await admin.from("ordini_prodotti_cache")
    .select("codice_articolo,descrizione,unita_misura,dati_mexal")
    .in("codice_articolo", codes);
  if (result.error) throw result.error;
  return new Map((result.data || []).map((row) => [text(row.codice_articolo).toUpperCase(), row]));
}

function requestStage(request) {
  const status = text(request?.workspace_status || request?.stato || "").toUpperCase();
  if (["EVASO", "COMPLETED", "PRODUCTIONCOMPLETED"].includes(status)) return "completed";
  if (["INPRODUCTION", "PLANNED", "PARTIALLYPLANNED"].includes(status)) return "production";
  if (["BLOCKED", "REJECTED", "CANCELLED", "FAILED"].includes(status)) return "blocked";
  return request ? "rdp" : "evaluation";
}

function publicDiagnostic(row) {
  return {
    diagnosticId: row.diagnosticId, severity: row.severity, errorCode: row.errorCode, phase: row.phase,
    entityType: row.entityType, entityId: row.entityId, articleCode: row.articleCode,
    title: row.title, description: row.description, actionRequired: row.actionRequired, status: row.status,
  };
}

export async function listProductionWorkbench({ admin, diagnostics = [] }) {
  const [{ data: orders, error: orderError }, { data: lines, error: lineError }, { data: requests, error: requestError }] = await Promise.all([
    admin.from("ordini_testate").select("*").eq("origine", "mexal_oct").order("data_consegna", { ascending: true }).limit(500),
    admin.from("ordini_righe").select("*").order("mexal_posizione", { ascending: true }).limit(5000),
    admin.from("workspace_production_requests").select("*").order("created_at", { ascending: false }).limit(500),
  ]);
  if (orderError || lineError || requestError) throw orderError || lineError || requestError;
  const customersByCode = await loadCustomers(admin, orders);
  const orderIds = new Set((orders || []).map((row) => text(row.id)));
  const relevantLines = (lines || []).filter((row) => orderIds.has(text(row.ordine_id)));
  const productsByCode = await loadProductsByCode(admin, relevantLines);
  const requestByOrder = new Map();
  for (const request of requests || []) if (request.ordine_id && !requestByOrder.has(text(request.ordine_id))) requestByOrder.set(text(request.ordine_id), request);
  const requestIds = (requests || []).map((row) => row.id);
  if (requestIds.length) {
    const result = await admin.from("workspace_production_request_items").select("production_request_id,ordine_id").in("production_request_id", requestIds);
    if (result.error) throw result.error;
    for (const item of result.data || []) if (!requestByOrder.has(text(item.ordine_id))) {
      const request = (requests || []).find((row) => text(row.id) === text(item.production_request_id));
      if (request) requestByOrder.set(text(item.ordine_id), request);
    }
  }
  return { generatedAt: new Date().toISOString(), items: (orders || []).map((order) => {
    const orderLines = relevantLines.filter((line) => text(line.ordine_id) === text(order.id));
    const productive = orderLines.filter((line) => !line.riga_descrittiva && text(line.codice_articolo) && number(line.quantita) > 0);
    const request = requestByOrder.get(text(order.id)) || null;
    const orderDiagnostics = diagnostics.filter((row) => [row.workspaceCommercialOctId, row.entityId].map(text).includes(text(order.id)));
    return {
      id: order.id, label: octLabel(order), sigla: order.mexal_sigla, serie: order.mexal_serie, numero: order.mexal_numero,
      customer: customerName(order, customersByCode),
      orderDate: order.data_ordine, deliveryDate: order.data_consegna,
      sourceTimestamp: order.updated_at || order.mexal_sincronizzato_il || order.created_at,
      status: request?.workspace_status || request?.stato || order.stato || "DA_VALUTARE", stage: requestStage(request),
      lineCount: orderLines.length, productiveLineCount: productive.length,
      quantity: productive.reduce((total, line) => total + number(line.quantita), 0),
      units: resolveWorkbenchUnits(productive, productsByCode),
      ready: productive.length > 0 && order.cliente_mexal_risolto !== false && !orderDiagnostics.some((row) => ["Blocking", "Critical"].includes(row.severity) && row.status !== "Resolved"),
      requestId: request?.id || null, requestExternalId: request?.external_id || null,
      diagnostics: orderDiagnostics.map(publicDiagnostic),
    };
  }) };
}

export async function productionWorkbenchDetail({ admin, orderId = null, requestId = null, diagnostics = [] }) {
  let request = null;
  if (requestId) {
    const result = await admin.from("workspace_production_requests").select("*").eq("id", requestId).maybeSingle();
    if (result.error) throw result.error;
    request = result.data;
  }
  const selectedOrderId = orderId || request?.ordine_id;
  if (!selectedOrderId && !request) throw Object.assign(new Error("OCT o RdP obbligatoria."), { status: 400 });
  const requestItemsResult = request ? await admin.from("workspace_production_request_items").select("*").eq("production_request_id", request.id).order("item_index") : { data: [], error: null };
  if (requestItemsResult.error) throw requestItemsResult.error;
  const relatedOrderIds = [...new Set([selectedOrderId, ...(requestItemsResult.data || []).map((item) => item.ordine_id)].filter(Boolean))];
  const [{ data: orders, error: ordersError }, { data: lines, error: linesError }] = await Promise.all([
    admin.from("ordini_testate").select("*").in("id", relatedOrderIds),
    admin.from("ordini_righe").select("*").in("ordine_id", relatedOrderIds).order("mexal_posizione"),
  ]);
  if (ordersError || linesError) throw ordersError || linesError;
  const customersByCode = await loadCustomers(admin, orders);
  let proposals = [];
  let productionEvents = [];
  if (request) {
    const [proposalResult, eventResult] = await Promise.all([
      admin.from("workspace_production_proposals").select("*").eq("production_request_id", request.id).order("production_index"),
      admin.from("workspace_production_event_inbox").select("event_type").eq("external_id", request.external_id),
    ]);
    if (proposalResult.error || eventResult.error) throw proposalResult.error || eventResult.error;
    proposals = proposalResult.data || [];
    productionEvents = eventResult.data || [];
  }
  let sentSnapshot = null;
  if (request?.sent_demand_snapshot_id) {
    const result = await admin.from("workspace_production_demand_snapshots").select("snapshot,captured_at").eq("id", request.sent_demand_snapshot_id).maybeSingle();
    if (result.error) throw result.error;
    sentSnapshot = result.data;
  }
  const productByCode = await loadProductsByCode(admin, lines);
  const currentOctUnit = (line) => resolveWorkbenchOctUnit(
    line,
    productByCode.get(text(line.codice_articolo).toUpperCase()),
  );
  const requestItemByLine = new Map((requestItemsResult.data || []).map((row) => [text(row.ordine_riga_id), row]));
  const proposalByItem = new Map(proposals.map((row) => [text(row.production_request_item_id), row]));
  const currentProductive = (lines || []).filter((line) => !line.riga_descrittiva && text(line.codice_articolo) && number(line.quantita) > 0);
  const previousItems = Array.isArray(sentSnapshot?.snapshot?.items) ? sentSnapshot.snapshot.items : [];
  const previousByLine = new Map(previousItems.map((item) => [text(item.lineId), item]));
  const currentByLine = new Map(currentProductive.map((line) => [text(line.id), line]));
  const delta = {
    added: currentProductive.filter((line) => !previousByLine.has(text(line.id))).map((line) => ({ lineId: line.id, articleCode: line.codice_articolo, quantity: line.quantita, uom: currentOctUnit(line) })),
    removed: previousItems.filter((item) => !currentByLine.has(text(item.lineId))).map((item) => ({ lineId: item.lineId, articleCode: item.commercialArticleCode, quantity: item.requestedQuantity, uom: item.requestedUnitOfMeasure })),
    changed: currentProductive.flatMap((line) => {
      const previous = previousByLine.get(text(line.id));
      if (!previous) return [];
      const uom = text(currentOctUnit(line)).toUpperCase();
      const changed = number(line.quantita) !== number(previous.requestedQuantity) || uom !== text(previous.requestedUnitOfMeasure).toUpperCase();
      return changed ? [{ lineId: line.id, articleCode: line.codice_articolo, fromQuantity: previous.requestedQuantity, toQuantity: line.quantita, fromUom: previous.requestedUnitOfMeasure, toUom: uom }] : [];
    }),
  };
  const deliveryChanged = (orders || []).some((order) => {
    const previous = (sentSnapshot?.snapshot?.orders || []).find((item) => text(item.orderId) === text(order.id));
    return previous && text(previous.requestedDeliveryDate) !== text(order.data_consegna);
  });
  return {
    orders: (orders || []).map((order) => ({ id: order.id, label: octLabel(order), customer: customerName(order, customersByCode), orderDate: order.data_ordine, deliveryDate: order.data_consegna })),
    request: request ? { ...request, stage: requestStage(request) } : null,
    cancellation: evaluateProductionRequestCancellation({ request, proposals, events: productionEvents }),
    revision: { modified: Boolean(sentSnapshot && (delta.added.length || delta.removed.length || delta.changed.length || deliveryChanged)), deliveryChanged, ...delta },
    lines: (lines || []).map((line) => {
      const product = productByCode.get(text(line.codice_articolo).toUpperCase());
      const requestItem = requestItemByLine.get(text(line.id));
      const proposal = proposalByItem.get(text(requestItem?.id));
      return {
        id: line.id, orderId: line.ordine_id, position: line.mexal_posizione, descriptive: line.riga_descrittiva === true,
        articleCode: line.codice_articolo, description: line.descrizione || product?.descrizione, quantity: line.quantita,
        octUom: resolveWorkbenchOctUnit(line, product), productionUom: requestItem?.unita_misura_produzione || authoritativeArticleUnit(product) || authoritativeArticleUnit(product?.dati_mexal),
        mappingStatus: requestItem?.mapping_status || "TO_RESOLVE_IN_MES", conversion: requestItem?.conversione || null,
        mesStatus: requestItem?.mes_status || proposal?.stato || null, mesAnalysis: requestItem?.mes_payload || null,
        proposal: proposal || null,
        diagnostics: diagnostics.filter((row) => (row.articleCode && text(row.articleCode).toUpperCase() === text(line.codice_articolo).toUpperCase()) || [row.workspaceOctLineRevisionId, row.entityId].map(text).includes(text(line.id))).map(publicDiagnostic),
      };
    }),
  };
}
