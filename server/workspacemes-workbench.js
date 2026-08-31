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

export function activeOctLines(lines) {
  return (lines || []).filter((line) => line?.mexal_attiva !== false);
}

export function workbenchDetailLines(lines, requestItems = []) {
  const requestedLineIds = new Set((requestItems || []).map((item) => text(item.ordine_riga_id)).filter(Boolean));
  return (lines || []).filter((line) => line?.mexal_attiva !== false || requestedLineIds.has(text(line.id)));
}

export function workbenchLineMappingStatus(line, requestItem = null, finishedBom = null) {
  if (line?.riga_descrittiva === true) return "NOT_APPLICABLE";
  if (finishedBom?.components?.length) return "BOM_EXPLODED";
  return requestItem?.mapping_status || "BOM_PENDING_IN_WORKSPACE";
}

export function workbenchBomComponent(row, finishedQuantity, baseQuantity = 1) {
  const kind = text(row?.component_kind).toUpperCase();
  const multiplier = number(baseQuantity) > 0 ? number(finishedQuantity) / number(baseQuantity) : 0;
  return {
    id: row?.id,
    lineNumber: row?.line_number,
    articleCode: text(row?.article_code).toUpperCase(),
    description: text(row?.description),
    componentKind: kind,
    quantityPerBase: number(row?.quantity),
    requiredQuantity: Number((number(row?.quantity) * multiplier).toFixed(6)),
    unitOfMeasure: text(row?.unit_of_measure).toUpperCase(),
    owner: "PROGREMES",
    status: kind === "FORMULA_COMPONENT" ? "TO_RESOLVE_IN_MES" : "TO_NET_IN_MES",
  };
}

export function diagnosticMatchesWorkbenchLine(row, line, request = null) {
  const lineId = text(line?.id);
  const requestIds = new Set([text(request?.id), text(request?.external_id)].filter(Boolean));
  const linkedLineIds = [row?.workspaceOctLineRevisionId,
    text(row?.entityType).toUpperCase().includes("OCT_LINE") ? row?.entityId : null].map(text).filter(Boolean);
  if (linkedLineIds.length) return linkedLineIds.includes(lineId);
  const linkedRequestIds = [row?.workspaceRdpV2Id,
    text(row?.entityType).toUpperCase().includes("RDP") ? row?.entityId : null].map(text).filter(Boolean);
  return linkedRequestIds.some((id) => requestIds.has(id)) && text(row?.articleCode).toUpperCase() === text(line?.codice_articolo).toUpperCase();
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

async function loadCurrentFinishedBoms(admin, lines) {
  const codes = [...new Set((lines || []).filter((line) => line?.riga_descrittiva !== true)
    .map((line) => text(line.codice_articolo).toUpperCase()).filter(Boolean))];
  if (!codes.length) return new Map();
  const revisionsResult = await admin.from("workspace_finished_bom_revisions").select("id,finished_article_code,revision,source_hash,base_quantity,unit_of_measure,effective_from")
    .in("finished_article_code", codes).eq("is_current", true);
  if (revisionsResult.error) throw revisionsResult.error;
  const revisions = revisionsResult.data || [];
  if (!revisions.length) return new Map();
  const linesResult = await admin.from("workspace_finished_bom_lines")
    .select("id,revision_id,line_number,article_code,description,quantity,unit_of_measure,component_kind,classification_source,formula_external_ref")
    .in("revision_id", revisions.map((row) => row.id)).eq("is_removed", false).order("line_number");
  if (linesResult.error) throw linesResult.error;
  const componentsByRevision = new Map();
  for (const row of linesResult.data || []) componentsByRevision.set(row.revision_id, [...(componentsByRevision.get(row.revision_id) || []), row]);
  return new Map(revisions.map((revision) => [text(revision.finished_article_code).toUpperCase(), {
    id: revision.id,
    revision: revision.revision,
    sourceHash: revision.source_hash,
    baseQuantity: number(revision.base_quantity),
    unitOfMeasure: revision.unit_of_measure,
    capturedAt: revision.effective_from,
    components: componentsByRevision.get(revision.id) || [],
  }]));
}

export function requestStage(request) {
  const status = text(request?.workspace_status || request?.stato || "").toUpperCase();
  if (status === "CANCELLED") return "history";
  if (["EVASO", "COMPLETED", "PRODUCTIONCOMPLETED"].includes(status)) return "completed";
  if (["INPRODUCTION"].includes(status)) return "production";
  if (["PLANNED", "PARTIALLYPLANNED"].includes(status)) return "planned";
  if (status === "CONFIRMED") return "scheduling";
  if (["BLOCKED", "REJECTED", "FAILED"].includes(status)) return "blocked";
  return request ? "rdp" : "evaluation";
}

export function confirmedV4ProductionRequest(request, confirmedRequestIds = new Set()) {
  if (!request || !confirmedRequestIds.has(text(request.id))) return request;
  return { ...request, stato: "CONFIRMED", workspace_status: "CONFIRMED" };
}

function mesOrderStatus(value) {
  return text(value).toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function canonicalReference(value) {
  return text(value).toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function productionOrderMatchesOct(order, octReference) {
  const expected = canonicalReference(octReference);
  if (!expected) return false;
  return [order?.riferimentoOct, order?.octReference, order?.riferimentiOct]
    .flatMap((value) => text(value).split(/[;,|]/))
    .some((value) => canonicalReference(value) === expected);
}

function isWorkspaceRdpProductionOrder(order) {
  return [order?.numeroOrdine, order?.riferimentoRdp, order?.rdpReference]
    .some((value) => /^RDP/i.test(text(value)));
}

export async function loadAllProductionOrders(client, pageSize = 500) {
  const items = [];
  for (let page = 1; page <= 100; page += 1) {
    const result = await client.request("production-orders", { page, pageSize });
    const pageItems = Array.isArray(result?.items) ? result.items : [];
    items.push(...pageItems);
    const total = Number(result?.total);
    if (!pageItems.length || !Number.isFinite(total) || items.length >= total) break;
  }
  return items;
}

export function rdpProductionState(request, productionOrders = [], octReference = null) {
  const progressive = Number(request?.rdp_number);
  const prefix = Number.isSafeInteger(progressive) && progressive > 0 ? `RDP${progressive}` : "";
  const candidates = (productionOrders || []).filter((order) => {
    const numberValue = text(order?.numeroOrdine).toUpperCase();
    const matchesRdp = prefix && (numberValue === prefix || numberValue.startsWith(`${prefix}-`));
    return mesOrderStatus(order?.stato) !== "ANNULLATO" &&
      (matchesRdp || productionOrderMatchesOct(order, octReference));
  });
  const rdpOrders = candidates.filter(isWorkspaceRdpProductionOrder);
  const matching = rdpOrders.length ? rdpOrders : candidates;
  if (!matching.length) return { stage: requestStage(request), status: null, plannedCompletionDate: null, orders: [] };
  const statuses = matching.map((order) => mesOrderStatus(order.stato));
  let stage = "scheduling";
  if (statuses.some((status) => status === "INPRODUZIONE")) stage = "production";
  else if (statuses.length && statuses.every((status) => ["COMPLETATO", "CHIUSO"].includes(status))) stage = "completed";
  else if (statuses.some((status) => status === "PIANIFICATO")) stage = "planned";
  const dates = stage === "scheduling"
    ? []
    : matching.map((order) => order.dataPrevistaConsegna).filter((value) => Number.isFinite(Date.parse(value)));
  const plannedCompletionDate = dates.length
    ? new Date(Math.max(...dates.map((value) => Date.parse(value)))).toISOString()
    : null;
  const status = stage === "scheduling" ? "IN PIANIFICAZIONE"
    : stage === "planned" ? "PIANIFICATO"
      : stage === "production" ? "IN PRODUZIONE"
        : stage === "completed" ? "COMPLETATO" : null;
  return { stage, status, plannedCompletionDate, orders: matching };
}

function cancelled(request) {
  return text(request?.workspace_status || request?.stato).toUpperCase() === "CANCELLED";
}

function publicDiagnostic(row) {
  return {
    diagnosticId: row.diagnosticId, severity: row.severity, errorCode: row.errorCode, sourceSystem: row.sourceSystem, phase: row.phase,
    entityType: row.entityType, entityId: row.entityId, articleCode: row.articleCode,
    title: row.title, description: row.description, actionRequired: row.actionRequired, status: row.status,
  };
}

export function visibleDiagnostic(row) {
  return text(row?.status).toUpperCase() !== "ARCHIVED";
}

export function v2DecisionAvailability(request, requestItems = []) {
  if (!request || Number(request.contract_version || 0) !== 2) return null;
  const analyses = requestItems.map((item) => item.mes_payload).filter(Boolean);
  return {
    available: text(request.workspace_status || request.stato).toUpperCase() === "AWAITINGDECISION" &&
      analyses.length > 0 && analyses.every((analysis) => !text(analysis.blockCode)),
    analysisCount: analyses.length,
    blocked: analyses.some((analysis) => Boolean(text(analysis.blockCode))),
  };
}

export function diagnosticBlocks(row) {
  return ["BLOCKING", "CRITICAL"].includes(text(row?.severity).toUpperCase()) &&
    ["OPEN", "ACKNOWLEDGED"].includes(text(row?.status).toUpperCase());
}

export async function listProductionWorkbench({ admin, diagnostics = [], productionOrders = [] }) {
  const [{ data: orders, error: orderError }, { data: lines, error: lineError }, { data: requests, error: requestError }] = await Promise.all([
    admin.from("ordini_testate").select("*").eq("origine", "mexal_oct").order("data_consegna", { ascending: true }).limit(500),
    admin.from("ordini_righe").select("*").order("mexal_posizione", { ascending: true }).limit(5000),
    admin.from("workspace_production_requests").select("*").order("created_at", { ascending: false }).limit(500),
  ]);
  if (orderError || lineError || requestError) throw orderError || lineError || requestError;
  const customersByCode = await loadCustomers(admin, orders);
  const orderIds = new Set((orders || []).map((row) => text(row.id)));
  const relevantLines = activeOctLines(lines).filter((row) => orderIds.has(text(row.ordine_id)));
  const allRelevantLines = (lines || []).filter((row) => orderIds.has(text(row.ordine_id)));
  const productsByCode = await loadProductsByCode(admin, relevantLines);
  const requestByOrder = new Map();
  const requestById = new Map((requests || []).map((request) => [text(request.id), request]));
  const orderIdsByRequest = new Map((requests || []).map((request) => [text(request.id), new Set([request.ordine_id].filter(Boolean).map(text))]));
  for (const request of requests || []) if (!cancelled(request) && request.ordine_id && !requestByOrder.has(text(request.ordine_id))) requestByOrder.set(text(request.ordine_id), request);
  const requestIds = (requests || []).map((row) => row.id);
  const confirmedV4RequestIds = new Set();
  if (requestIds.length) {
    const [itemsResult, previewsResult] = await Promise.all([
      admin.from("workspace_production_request_items").select("production_request_id,ordine_id").in("production_request_id", requestIds),
      admin.from("workspace_v4_previews").select("id,production_request_id").in("production_request_id", requestIds),
    ]);
    if (itemsResult.error || previewsResult.error) throw itemsResult.error || previewsResult.error;
    for (const item of itemsResult.data || []) {
      const request = requestById.get(text(item.production_request_id));
      orderIdsByRequest.get(text(item.production_request_id))?.add(text(item.ordine_id));
      if (request && !cancelled(request) && !requestByOrder.has(text(item.ordine_id))) requestByOrder.set(text(item.ordine_id), request);
    }
    const requestIdByPreview = new Map((previewsResult.data || []).map((preview) => [text(preview.id), text(preview.production_request_id)]));
    const previewIds = [...requestIdByPreview.keys()];
    if (previewIds.length) {
      const confirmationsResult = await admin.from("workspace_v4_confirmation_mirrors").select("preview_id").in("preview_id", previewIds);
      if (confirmationsResult.error) throw confirmationsResult.error;
      for (const confirmation of confirmationsResult.data || []) {
        const confirmedRequestId = requestIdByPreview.get(text(confirmation.preview_id));
        if (confirmedRequestId) confirmedV4RequestIds.add(confirmedRequestId);
      }
    }
  }
  const items = (orders || []).map((order) => {
    const orderLines = relevantLines.filter((line) => text(line.ordine_id) === text(order.id));
    const productive = orderLines.filter((line) => !line.riga_descrittiva && text(line.codice_articolo) && number(line.quantita) > 0);
    const request = confirmedV4ProductionRequest(requestByOrder.get(text(order.id)) || null, confirmedV4RequestIds);
    const orderDiagnostics = diagnostics.filter((row) => visibleDiagnostic(row) && [row.workspaceCommercialOctId, row.entityId].map(text).includes(text(order.id)));
    const productionState = rdpProductionState(request, productionOrders, octLabel(order));
    return {
      id: order.id, label: octLabel(order), sigla: order.mexal_sigla, serie: order.mexal_serie, numero: order.mexal_numero,
      customer: customerName(order, customersByCode),
      orderDate: order.data_ordine, deliveryDate: order.data_consegna,
      sourceTimestamp: order.updated_at || order.mexal_sincronizzato_il || order.created_at,
      status: productionState.status || request?.workspace_status || request?.stato || order.stato || "DA_VALUTARE", stage: productionState.stage,
      plannedCompletionDate: productionState.plannedCompletionDate,
      productionOrders: productionState.orders,
      lineCount: orderLines.length, productiveLineCount: productive.length,
      quantity: productive.reduce((total, line) => total + number(line.quantita), 0),
      units: resolveWorkbenchUnits(productive, productsByCode),
      lines: productive.map((line) => {
        const product = productsByCode.get(text(line.codice_articolo).toUpperCase());
        const orderedQuantity = number(line.quantita);
        const fulfilledQuantity = Math.min(orderedQuantity, Math.max(0, number(line.quantita_evasa)));
        return {
          id: line.id,
          position: line.mexal_posizione,
          articleCode: line.codice_articolo,
          description: line.descrizione || product?.descrizione || "—",
          orderedQuantity,
          fulfilledQuantity,
          residualQuantity: Math.max(0, orderedQuantity - fulfilledQuantity),
          unit: resolveWorkbenchOctUnit(line, product),
          deliveryDate: line.data_consegna || order.data_consegna,
          productionStatus: productionState.status || (request ? (request.workspace_status || request.stato || "RdP") : "Da generare"),
        };
      }),
      ready: productive.length > 0 && order.cliente_mexal_risolto !== false && !orderDiagnostics.some(diagnosticBlocks),
      requestId: request?.id || null, requestExternalId: request?.external_id || null, rdpNumber: request?.rdp_number || null,
      diagnostics: orderDiagnostics.map(publicDiagnostic),
    };
  });
  const orderById = new Map((orders || []).map((order) => [text(order.id), order]));
  const history = (requests || []).filter(cancelled).map((request) => {
    const historicalOrders = [...(orderIdsByRequest.get(text(request.id)) || [])].map((id) => orderById.get(id)).filter(Boolean);
    const historicalOrderIds = new Set(historicalOrders.map((order) => text(order.id)));
    const historicalLines = allRelevantLines.filter((line) => historicalOrderIds.has(text(line.ordine_id)));
    const productive = historicalLines.filter((line) => !line.riga_descrittiva && text(line.codice_articolo) && number(line.quantita) > 0);
    const labels = historicalOrders.map(octLabel).filter(Boolean);
    const customers = [...new Set(historicalOrders.map((order) => customerName(order, customersByCode)).filter(Boolean))];
    return {
      id: `history:${request.id}`, orderId: historicalOrders[0]?.id || request.ordine_id,
      label: labels.join(", ") || "RdP storica", customer: customers.join(", ") || "—",
      orderDate: historicalOrders[0]?.data_ordine, deliveryDate: historicalOrders[0]?.data_consegna,
      sourceTimestamp: request.cancelled_at || request.updated_at || request.created_at,
      status: "Cancelled", stage: "history", ready: false,
      lineCount: historicalLines.length, productiveLineCount: productive.length,
      quantity: productive.reduce((total, line) => total + number(line.quantita), 0),
      units: resolveWorkbenchUnits(productive, productsByCode),
      requestId: request.id, requestExternalId: request.external_id, rdpNumber: request.rdp_number || null, diagnostics: [],
    };
  });
  return { generatedAt: new Date().toISOString(), items, history };
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
  const currentLines = activeOctLines(lines);
  const visibleLines = request ? workbenchDetailLines(lines, requestItemsResult.data || []) : currentLines;
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
  const lineageSnapshotId = [3, 4].includes(Number(request?.contract_version)) ? request?.demand_snapshot_id : request?.sent_demand_snapshot_id;
  if (lineageSnapshotId) {
    const result = await admin.from("workspace_production_demand_snapshots").select("snapshot,captured_at").eq("id", lineageSnapshotId).maybeSingle();
    if (result.error) throw result.error;
    sentSnapshot = result.data;
  }
  const productByCode = await loadProductsByCode(admin, visibleLines);
  const finishedBomByCode = await loadCurrentFinishedBoms(admin, visibleLines);
  const currentOctUnit = (line) => resolveWorkbenchOctUnit(
    line,
    productByCode.get(text(line.codice_articolo).toUpperCase()),
  );
  const requestItemByLine = new Map((requestItemsResult.data || []).map((row) => [text(row.ordine_riga_id), row]));
  const proposalByItem = new Map(proposals.map((row) => [text(row.production_request_item_id), row]));
  const currentProductive = currentLines.filter((line) => !line.riga_descrittiva && text(line.codice_articolo) && number(line.quantita) > 0);
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
  const v2Decision = null;
  let v3 = null;
  if (request) {
    const [flagsResult, previewResult] = await Promise.all([
      admin.from("workspace_v4_feature_flags").select("key,enabled").in("key", ["workspacemes.v4.preview", "workspacemes.v4.confirm"]),
      admin.from("workspace_v4_previews").select("*").eq("production_request_id", request.id)
        .order("captured_at", { ascending: false }).limit(1),
    ]);
    if (flagsResult.error || previewResult.error) throw flagsResult.error || previewResult.error;
    const flags = Object.fromEntries((flagsResult.data || []).map((row) => [row.key, row.enabled === true]));
    const preview = previewResult.data?.[0] || null;
    let components = []; let saga = null; let commitments = []; let requirements = []; let purchaseDocuments = [];
    if (preview) {
      const componentResult = await admin.from("workspace_v4_preview_materials").select("*")
        .eq("preview_id", preview.id).order("id");
      if (componentResult.error) throw componentResult.error;
      components = componentResult.data || [];
      const sagaResult = await admin.from("workspace_v4_confirmation_mirrors").select("*")
        .eq("preview_id", preview.id).order("created_at", { ascending: false }).limit(1);
      if (sagaResult.error) throw sagaResult.error;
      saga = sagaResult.data?.[0] || null;
      if (saga) {
        const [commitmentResult, requirementResult] = await Promise.all([
          Promise.resolve({ data: [], error: null }),
          admin.from("workspace_v4_purchase_requirements").select("*").eq("confirmation_id", saga.id).order("id"),
        ]);
        if (commitmentResult.error || requirementResult.error) throw commitmentResult.error || requirementResult.error;
        commitments = commitmentResult.data || []; requirements = requirementResult.data || [];
      }
    }
    v3 = { flags, preview, components, saga, commitments, requirements, purchaseDocuments,
      blockers: components.filter((row) => text(row.block_code)).map((row) => ({ articleCode: row.article_code, code: row.block_code, owner: "PROGREMES" })) };
  }
  return {
    orders: (orders || []).map((order) => ({ id: order.id, label: octLabel(order), customer: customerName(order, customersByCode), orderDate: order.data_ordine, deliveryDate: order.data_consegna })),
    request: request ? { ...request, stage: requestStage(request) } : null,
    cancellation: evaluateProductionRequestCancellation({ request, proposals, events: productionEvents }),
    v2Decision,
    v3,
    revision: { modified: Boolean(sentSnapshot && (delta.added.length || delta.removed.length || delta.changed.length || deliveryChanged)), deliveryChanged, ...delta },
    lines: visibleLines.map((line) => {
      const product = productByCode.get(text(line.codice_articolo).toUpperCase());
      const requestItem = requestItemByLine.get(text(line.id));
      const proposal = proposalByItem.get(text(requestItem?.id));
      const finishedBomSource = finishedBomByCode.get(text(line.codice_articolo).toUpperCase());
      const finishedBom = finishedBomSource ? {
        ...finishedBomSource,
        components: finishedBomSource.components.map((component) => workbenchBomComponent(component, line.quantita, finishedBomSource.baseQuantity)),
      } : null;
      return {
        id: line.id, orderId: line.ordine_id, position: line.mexal_posizione, descriptive: line.riga_descrittiva === true,
        articleCode: line.codice_articolo, description: line.descrizione || product?.descrizione, quantity: line.quantita,
        octUom: resolveWorkbenchOctUnit(line, product), productionUom: line.riga_descrittiva === true ? null : requestItem?.unita_misura_produzione || authoritativeArticleUnit(product) || authoritativeArticleUnit(product?.dati_mexal),
        mappingStatus: workbenchLineMappingStatus(line, requestItem, finishedBom), conversion: line.riga_descrittiva === true ? null : requestItem?.conversione || null,
        finishedBom,
        mesStatus: line.riga_descrittiva === true ? null : requestItem?.mes_status || proposal?.stato || null, mesAnalysis: line.riga_descrittiva === true ? null : requestItem?.mes_payload || null,
        proposal: line.riga_descrittiva === true ? null : proposal || null,
        diagnostics: diagnostics.filter((row) => visibleDiagnostic(row) && diagnosticMatchesWorkbenchLine(row, line, request)).map(publicDiagnostic),
      };
    }),
  };
}
