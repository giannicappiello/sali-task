import { randomUUID } from "node:crypto";
import { aggregateWorkspaceHashes, createProgremesProductionClient } from "./progremes-production-client.js";
import { COMPONENT_KIND, confirmationIdempotencyKey, explodeFinishedBom, netDirectComponent, payloadHash } from "./workspacemes-v3.js";

const clean = (value) => String(value ?? "").trim();
const upper = (value) => clean(value).toUpperCase();
const positive = (value) => Number.isFinite(Number(value)) && Number(value) > 0;
const fail = (message, code, status = 409) => Object.assign(new Error(message), { code, status });
const ensure = (result) => { if (result.error) throw result.error; return result.data || []; };

export async function workspaceV3FinishedArticleCodes(admin, requestId) {
  const requests = ensure(await admin.from("workspace_production_requests")
    .select("sent_demand_snapshot_id").eq("id", requestId).limit(1));
  if (!requests[0]?.sent_demand_snapshot_id) throw fail("La RdP v2 inviata è necessaria per il lineage V3.", "V3_RDP_REQUIRED");
  const snapshots = ensure(await admin.from("workspace_production_demand_snapshots")
    .select("snapshot").eq("id", requests[0].sent_demand_snapshot_id).limit(1));
  const items = snapshots[0]?.snapshot?.items;
  if (!Array.isArray(items) || !items.length) throw fail("Snapshot domanda v2 incompleto.", "V3_DEMAND_REQUIRED");
  return [...new Set(items.map((item) => upper(item.commercialArticleCode)).filter(Boolean))];
}

async function loadPreviewInputs(admin, requestId) {
  const requestRows = ensure(await admin.from("workspace_production_requests")
    .select("id,external_id,contract_version,sent_demand_snapshot_id,workspace_status,stato")
    .eq("id", requestId).limit(1));
  const request = requestRows[0];
  if (!request?.sent_demand_snapshot_id || Number(request.contract_version) !== 2)
    throw fail("La RdP v2 inviata è necessaria per il lineage V3.", "V3_RDP_REQUIRED");
  const snapshotRows = ensure(await admin.from("workspace_production_demand_snapshots")
    .select("snapshot,captured_at").eq("id", request.sent_demand_snapshot_id).limit(1));
  const demand = snapshotRows[0]?.snapshot;
  if (!Array.isArray(demand?.items) || !demand.items.length || !Array.isArray(demand?.orders) || !demand.orders.length)
    throw fail("Snapshot domanda v2 incompleto.", "V3_DEMAND_REQUIRED");

  const articleCodes = [...new Set(demand.items.map((item) => upper(item.commercialArticleCode)).filter(Boolean))];
  const bomRevisions = ensure(await admin.from("workspace_finished_bom_revisions").select("*")
    .in("finished_article_code", articleCodes).eq("is_current", true));
  const revisionByCode = new Map(bomRevisions.map((row) => [upper(row.finished_article_code), row]));
  const missing = articleCodes.filter((code) => !revisionByCode.has(code));
  if (missing.length) throw fail(`Distinta Mexal V3 mancante: ${missing.join(", ")}.`, "FINISHED_BOM_MISSING");
  const bomLines = ensure(await admin.from("workspace_finished_bom_lines").select("*")
    .in("revision_id", bomRevisions.map((row) => row.id)).eq("is_removed", false));
  const linesByRevision = new Map();
  for (const line of bomLines) linesByRevision.set(line.revision_id, [...(linesByRevision.get(line.revision_id) || []), line]);

  const componentCodes = [...new Set(bomLines.map((line) => upper(line.article_code)))];
  const products = ensure(await admin.from("ordini_prodotti_cache")
    .select("codice_articolo,descrizione,unita_misura,giacenza,impegnato,sincronizzato_il,dati_mexal")
    .in("codice_articolo", componentCodes));
  const productByCode = new Map(products.map((row) => [upper(row.codice_articolo), row]));
  const commitments = ensure(await admin.from("workspace_v3_material_commitments")
    .select("article_code,quantity,owner,status").eq("status", "ACTIVE").eq("owner", "WORKSPACE_DIRECT"));
  const committedByCode = new Map();
  for (const row of commitments) committedByCode.set(upper(row.article_code), (committedByCode.get(upper(row.article_code)) || 0) + Number(row.quantity || 0));

  const supplierSnapshots = ensure(await admin.from("workspace_supplier_order_snapshots")
    .select("id,snapshot_hash,captured_at").order("captured_at", { ascending: false }).limit(1));
  const supplierSnapshot = supplierSnapshots[0] || null;
  const supplierLines = supplierSnapshot ? ensure(await admin.from("workspace_supplier_order_snapshot_lines")
    .select("article_code,unit_of_measure,remaining_quantity,expected_at,active,order_external_key,line_external_key")
    .eq("snapshot_id", supplierSnapshot.id).eq("active", true)) : [];
  const suppliesByCode = new Map();
  for (const row of supplierLines) suppliesByCode.set(upper(row.article_code), [...(suppliesByCode.get(upper(row.article_code)) || []), row]);
  return { request, demand, revisionByCode, linesByRevision, productByCode, committedByCode, supplierSnapshot, suppliesByCode };
}

function bomFor(revision, lines) {
  return {
    revision: revision.revision,
    hash: revision.source_hash,
    baseQuantity: revision.base_quantity,
    lines: lines.map((line) => ({
      id: line.id,
      lineExternalId: line.source_line_key,
      articleCode: line.article_code,
      description: line.description,
      quantity: line.quantity,
      unitOfMeasure: line.unit_of_measure,
      componentKind: line.component_kind,
      formulaExternalId: line.formula_external_ref,
    })),
  };
}

export function createFormulaDemand({ component, sources, requestId }) {
  return {
    workspaceLineId: component.workspaceLineId,
    fpCode: component.articleCode,
    quantity: component.requiredQuantity,
    octRevision: sources.find((source) => clean(source.order_line_id) === clean(component.workspaceLineId))?.oct_revision || 1,
    rdpRevision: clean(requestId),
  };
}

export async function createWorkspaceV3Preview({ admin, requestId, requestedBy, client = createProgremesProductionClient() }) {
  if (!client.v3PreviewEnabled()) throw fail("Preview WorkspaceMES V3 disabilitata.", "V3_PREVIEW_DISABLED", 403);
  const input = await loadPreviewInputs(admin, requestId);
  const orderById = new Map(input.demand.orders.map((order) => [clean(order.orderId), order]));
  const sources = [];
  const expanded = [];
  for (const item of input.demand.items) {
    const articleCode = upper(item.commercialArticleCode);
    const revision = input.revisionByCode.get(articleCode);
    const quantity = Number(item.productionQuantity ?? item.requestedQuantity);
    if (!positive(quantity)) throw fail(`Quantità prodotto finito non valida per ${articleCode}.`, "INVALID_FINISHED_QUANTITY");
    const components = explodeFinishedBom({ bomRevision: bomFor(revision, input.linesByRevision.get(revision.id) || []), finishedQuantity: quantity });
    const order = orderById.get(clean(item.orderId));
    sources.push({ order_id: item.orderId, order_line_id: item.lineId, bom_revision_id: revision.id,
      finished_article_code: articleCode, finished_quantity: quantity, unit_of_measure: upper(item.productionUnitOfMeasure),
      oct_revision: Number(order?.commercialRevision || 1), oct_hash: clean(order?.versionHash), bom_hash: revision.source_hash });
    expanded.push(...components.map((component) => ({ ...component, bomLineId: Number(component.lineExternalId) ||
      (input.linesByRevision.get(revision.id) || []).find((line) => line.source_line_key === component.lineExternalId)?.id,
      workspaceLineId: item.lineId, requiredAt: item.requestedDeliveryDate || order?.requestedDeliveryDate })));
  }
  const directComponents = expanded.filter((row) => row.componentKind === COMPONENT_KIND.DIRECT);
  const formulaComponents = expanded.filter((row) => row.componentKind === COMPONENT_KIND.FORMULA);
  const directGroups = new Map();
  for (const component of directComponents) {
    const key = `${component.articleCode}:${component.unitOfMeasure}`;
    const current = directGroups.get(key);
    if (!current) directGroups.set(key, { ...component, sourceBomLineIds: [component.bomLineId] });
    else {
      current.requiredQuantity += component.requiredQuantity;
      current.requiredAt = [current.requiredAt, component.requiredAt].filter(Boolean).sort()[0] || null;
      current.sourceBomLineIds.push(component.bomLineId);
    }
  }
  const directRows = [...directGroups.values()].map((component) => {
    const product = input.productByCode.get(component.articleCode);
    const supplies = input.suppliesByCode.get(component.articleCode) || [];
    if (supplies.some((supply) => upper(supply.unit_of_measure) !== component.unitOfMeasure))
      throw fail(`UDM fornitura non compatibile per ${component.articleCode}.`, "SUPPLIER_UOM_MISMATCH");
    const net = netDirectComponent({ requiredQuantity: component.requiredQuantity, onHandQuantity: product?.giacenza,
      committedQuantity: Number(product?.impegnato || 0) + Number(input.committedByCode.get(component.articleCode) || 0),
      requiredAt: component.requiredAt, supplies: supplies.map((row) => ({ confirmed: row.active,
        remainingQuantity: row.remaining_quantity, expectedAt: row.expected_at })) });
    return { bomLineId: component.bomLineId, componentKind: component.componentKind, articleCode: component.articleCode,
      unitOfMeasure: component.unitOfMeasure, requiredQuantity: net.required, onHandQuantity: net.onHand,
      committedQuantity: net.committed, incomingQuantity: net.confirmedSupply, uncoveredQuantity: net.uncovered,
      requiredAt: component.requiredAt, expectedAvailableAt: null, calculationOwner: "WORKSPACE", blockerCode: null,
      certifiedPayload: { usable: net.usable, sourceBomLineIds: component.sourceBomLineIds,
        mexalCommitted: Number(product?.impegnato || 0), v3Committed: Number(input.committedByCode.get(component.articleCode) || 0),
        supplierSnapshotHash: input.supplierSnapshot?.snapshot_hash || null,
        supplierReceiptSemantics: "NOT_EXPOSED_BY_MEXAL_ENDPOINT" } };
  });
  const octHash = aggregateWorkspaceHashes(input.demand.orders.map((order) => order.versionHash));
  const bomHash = aggregateWorkspaceHashes(sources.map((source) => source.bom_hash));
  const availabilityVersion = payloadHash({ products: [...input.productByCode.values()].map((row) => [row.codice_articolo,row.giacenza,row.impegnato,row.sincronizzato_il]),
    commitments: [...input.committedByCode], supplierSnapshotHash: input.supplierSnapshot?.snapshot_hash || null });
  const externalId = randomUUID();
  const correlationId = randomUUID();
  const mesCommand = { contractVersion: 3, workspaceRdpExternalId: input.request.external_id, externalId,
    idempotencyKey: `workspacemes:v3:preview:${payloadHash({ requestId, octHash, bomHash, availabilityVersion })}`,
    expectedOctHash: octHash, finishedBomHash: bomHash, availabilityVersion,
    requiredAt: sources.map((source) => orderById.get(clean(source.order_id))?.requestedDeliveryDate).filter(Boolean).sort()[0] || new Date().toISOString(),
    correlationId, causationId: input.request.external_id,
    formulaDemands: formulaComponents.map((component) => createFormulaDemand({ component, sources, requestId })) };
  const mes = await client.previewV3(mesCommand);
  const formulaByLine = new Map((mes.result.formulas || []).map((formula) => [`${clean(formula.workspaceLineId)}:${upper(formula.fpCode)}`, formula]));
  const formulaRows = formulaComponents.flatMap((component) => {
    const formula = formulaByLine.get(`${clean(component.workspaceLineId)}:${component.articleCode}`);
    const parent = { bomLineId: component.bomLineId, componentKind: "FORMULA_COMPONENT", articleCode: component.articleCode,
      unitOfMeasure: upper(formula?.unitOfMeasure), requiredQuantity: component.requiredQuantity, onHandQuantity: 0,
      committedQuantity: 0, incomingQuantity: 0, uncoveredQuantity: 0, expectedAvailableAt: null,
      requiredAt: component.requiredAt,
      calculationOwner: "PROGREMES", formulaCode: formula?.formulaCode || null, formulaRevision: formula?.formulaRevision || null,
      formulaSnapshotHash: mes.result.snapshotHash, batch: formula?.batch || null, station: formula?.station || null,
      filling: formula?.filling || null, blockerCode: formula?.blocker || "MES_FORMULA_PREVIEW_MISSING", certifiedPayload: formula || {} };
    const materials = (formula?.materials || []).map((material) => ({ bomLineId: component.bomLineId,
      parentArticleCode: component.articleCode, componentKind: "FORMULA_MATERIAL", articleCode: material.articleCode,
      unitOfMeasure: material.unitOfMeasure, requiredQuantity: material.required, onHandQuantity: material.physical,
      committedQuantity: material.committed, incomingQuantity: material.incoming, uncoveredQuantity: material.uncovered,
      requiredAt: component.requiredAt, expectedAvailableAt: material.expectedAvailabilityDate || null, calculationOwner: "PROGREMES",
      formulaCode: formula.formulaCode, formulaRevision: formula.formulaRevision, formulaSnapshotHash: material.certifiedHash,
      batch: formula.batch || null, station: formula.station || null, filling: formula.filling || null,
      blockerCode: material.blockCode || null, certifiedPayload: material }));
    return [parent, ...materials];
  });
  const components = [...directRows, ...formulaRows];
  const status = components.some((row) => clean(row.blockerCode)) || mes.result.status === "Blocked" ? "BLOCKED" : "READY";
  const snapshot = { contractVersion: 3, requestId, mes: mes.result, sources, components, availabilityVersion };
  const previewHash = payloadHash(snapshot);
  const persisted = ensure(await admin.rpc("persist_workspace_v3_preview", { p_external_id: externalId,
    p_production_request_id: requestId, p_preview_hash: previewHash, p_idempotency_key: mesCommand.idempotencyKey,
    p_payload_hash: payloadHash(mesCommand), p_status: status, p_oct_revision: Math.max(...sources.map((source) => source.oct_revision)),
    p_oct_hash: octHash, p_bom_hash: bomHash, p_availability_version: availabilityVersion, p_snapshot: snapshot,
    p_correlation_id: correlationId, p_causation_id: input.request.external_id, p_requested_by: requestedBy,
    p_sources: sources, p_components: components }))[0];
  return { ...persisted, externalId, previewHash, status, components, mutatesProduction: false };
}

export async function confirmWorkspaceV3({ admin, previewId, reason, requestedBy, client = createProgremesProductionClient() }) {
  if (!client.v3ConfirmationEnabled()) throw fail("Conferma WorkspaceMES V3 disabilitata.", "V3_CONFIRM_DISABLED", 403);
  if (clean(reason).length < 5) throw fail("Motivazione obbligatoria.", "INVALID_REASON", 400);
  const previews = ensure(await admin.from("workspace_v3_previews").select("*").eq("id", previewId).limit(1));
  const preview = previews[0];
  if (!preview || preview.status !== "READY") throw fail("Preview V3 non confermabile.", "V3_PREVIEW_NOT_READY");
  const requests = ensure(await admin.from("workspace_production_requests").select("id,external_id,sent_demand_snapshot_id")
    .eq("id", preview.production_request_id).limit(1));
  const request = requests[0];
  const [items, snapshots] = await Promise.all([
    admin.from("workspace_production_request_items").select("mes_payload").eq("production_request_id", request.id),
    admin.from("workspace_production_demand_snapshots").select("snapshot").eq("id", request.sent_demand_snapshot_id).limit(1),
  ]);
  const itemRows = ensure(items); const snapshotRows = ensure(snapshots);
  const analysisHashes = itemRows.map((row) => clean(row.mes_payload?.snapshotHash)).filter(Boolean);
  const octHashes = (snapshotRows[0]?.snapshot?.orders || []).map((order) => clean(order.versionHash)).filter(Boolean);
  if (!analysisHashes.length || !octHashes.length) throw fail("Hash analisi v2 necessari alla conferma V3 mancanti.", "V3_ANALYSIS_HASH_MISSING");
  const externalId = randomUUID();
  const command = { contractVersion: 3, externalId, previewExternalId: preview.external_id,
    idempotencyKey: confirmationIdempotencyKey({ previewHash: preview.preview_hash }), expectedPreviewHash: preview.snapshot?.mes?.snapshotHash,
    expectedAnalysisHash: aggregateWorkspaceHashes(analysisHashes), expectedOctVersionHash: aggregateWorkspaceHashes(octHashes),
    reason: clean(reason), decidedBy: `workspace:${requestedBy || "service"}`, correlationId: preview.correlation_id,
    causationId: preview.external_id };
  const mes = await client.confirmV3(request.external_id, command);
  if (!mes.result.productionCreated || !mes.result.productionOrders.length)
    throw fail("MES non ha creato alcun OdP.", "V3_PRODUCTION_NOT_CREATED");
  const firstOrder = mes.result.productionOrders[0];
  const result = ensure(await admin.rpc("confirm_workspace_v3_after_mes", { p_preview_id: preview.id,
    p_external_id: externalId, p_idempotency_key: command.idempotencyKey, p_payload_hash: payloadHash(command),
    p_expected_row_version: preview.row_version, p_mes_confirmation_id: mes.result.externalId,
    p_mes_production_order_id: Number(firstOrder.id), p_mes_production_order_number: firstOrder.number,
    p_actor: requestedBy || "workspace:service", p_correlation_id: preview.correlation_id,
    p_causation_id: preview.external_id }));
  return { saga: result[0], mes: mes.result };
}
