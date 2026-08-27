function text(value) { return String(value ?? "").trim(); }
function upper(value) { return text(value).toUpperCase(); }
function uuid(value) { return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text(value)); }

async function selectByIds(admin, table, columns, column, values) {
  const ids = [...new Set(values.map(text).filter(uuid))];
  if (!ids.length) return [];
  const result = await admin.from(table).select(columns).in(column, ids);
  if (result.error) throw result.error;
  return result.data || [];
}

export async function effectiveWorkspaceDiagnostics({ admin, diagnostics = [] }) {
  const rdpIds = diagnostics.flatMap((row) => [
    row.workspaceRdpV2Id,
    upper(row.entityType).includes("RDP") ? row.entityId : null,
  ]);
  const lineIds = diagnostics.flatMap((row) => [
    row.workspaceOctLineRevisionId,
    upper(row.entityType).includes("OCT_LINE") ? row.entityId : null,
  ]);
  const [requestsById, requestsByExternalId, lines, requestItems] = await Promise.all([
    selectByIds(admin, "workspace_production_requests", "id,external_id,workspace_status,stato", "id", rdpIds),
    selectByIds(admin, "workspace_production_requests", "id,external_id,workspace_status,stato", "external_id", rdpIds),
    selectByIds(admin, "ordini_righe", "id,mexal_attiva", "id", lineIds),
    selectByIds(admin, "workspace_production_request_items", "production_request_id,ordine_riga_id", "ordine_riga_id", lineIds),
  ]);
  const itemRequestIds = requestItems.map((row) => row.production_request_id);
  const requestsByItem = await selectByIds(admin, "workspace_production_requests", "id,external_id,workspace_status,stato", "id", itemRequestIds);
  const requests = [...requestsById, ...requestsByExternalId, ...requestsByItem];
  const cancelledIds = new Set(requests
    .filter((row) => upper(row.workspace_status || row.stato) === "CANCELLED")
    .flatMap((row) => [text(row.id), text(row.external_id)]).filter(Boolean));
  const retiredLineIds = new Set(lines.filter((row) => row.mexal_attiva === false).map((row) => text(row.id)));
  const requestStatusById = new Map(requests.map((row) => [text(row.id), upper(row.workspace_status || row.stato)]));
  const requestsByLine = new Map();
  for (const item of requestItems) {
    const lineId = text(item.ordine_riga_id);
    const values = requestsByLine.get(lineId) || [];
    values.push(text(item.production_request_id));
    requestsByLine.set(lineId, values);
  }
  const cancelledOnlyLineIds = new Set([...requestsByLine.entries()]
    .filter(([, ids]) => ids.length > 0 && ids.every((id) => requestStatusById.get(id) === "CANCELLED"))
    .map(([lineId]) => lineId));

  return diagnostics.map((row) => {
    const linkedRdpIds = [row.workspaceRdpV2Id, upper(row.entityType).includes("RDP") ? row.entityId : null].map(text);
    const linkedLineIds = [row.workspaceOctLineRevisionId, upper(row.entityType).includes("OCT_LINE") ? row.entityId : null].map(text);
    const historical = linkedRdpIds.some((id) => cancelledIds.has(id)) ||
      linkedLineIds.some((id) => retiredLineIds.has(id) || cancelledOnlyLineIds.has(id));
    if (!historical || ["RESOLVED", "IGNORED"].includes(upper(row.status))) return row;
    return {
      ...row,
      originalStatus: row.status,
      status: "Resolved",
      workspaceDisposition: "Historical",
      actionRequired: "Evento storico: la RdP è annullata o la riga OCT è stata ritirata; nessuna azione operativa richiesta.",
    };
  });
}

export function effectiveDiagnosticsHealth(health, diagnostics = []) {
  const active = diagnostics.filter((row) => !["RESOLVED", "IGNORED"].includes(upper(row.status)));
  const count = (severity) => active.filter((row) => upper(row.severity) === severity).length;
  const info = count("INFO");
  const warning = count("WARNING");
  const blocking = count("BLOCKING");
  const critical = count("CRITICAL");
  const lastSuccess = Date.parse(text(health?.lastMexalSuccess));
  const lastError = Date.parse(text(health?.lastMexalError));
  const mexalFailed = Number.isFinite(lastError) && (!Number.isFinite(lastSuccess) || lastError > lastSuccess);
  const hardFailure = health?.database !== true || health?.workspaceCallbacks !== true || mexalFailed || blocking > 0 || critical > 0;
  const warningState = warning > 0 || Number(health?.pendingOutbox || 0) > 0;
  return {
    ...health,
    globalStatus: hardFailure ? "RED" : warningState ? "YELLOW" : "GREEN",
    open: active.length,
    info,
    warning,
    blocking,
    critical,
  };
}
