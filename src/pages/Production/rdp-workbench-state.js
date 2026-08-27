export function confirmedProductionOrder(payload = {}) {
  const productionOrders = Array.isArray(payload?.productionOrders) ? payload.productionOrders : [];
  const directOrder = productionOrders.find((item) => Number.isSafeInteger(Number(item?.id)) && Number(item.id) > 0);
  if (directOrder) return { id: Number(directOrder.id), number: String(directOrder.number || "").trim() || null };
  const proposals = Array.isArray(payload?.proposals) ? payload.proposals : [];
  const proposal = proposals.find((item) => Number.isSafeInteger(Number(item?.productionOrderId)) && Number(item.productionOrderId) > 0);
  if (!proposal) return null;
  return {
    id: Number(proposal.productionOrderId),
    number: String(proposal.productionOrderNumber || "").trim() || null,
  };
}

export function productionOrderProgremesPath(result = {}) {
  const screenCode = encodeURIComponent("progremes.Ordini.Produzione");
  const params = new URLSearchParams();
  const productionOrderId = Number(result?.productionOrder?.id);
  if (Number.isSafeInteger(productionOrderId) && productionOrderId > 0) params.set("odpId", String(productionOrderId));
  const rdpId = String(result?.externalId || "").trim();
  if (rdpId) params.set("rdpId", rdpId);
  const query = params.toString();
  return `/produzione/${screenCode}${query ? `?${query}` : ""}`;
}

export function diagnosticIsManageable(diagnostic = {}) {
  return !["RESOLVED", "IGNORED", "ARCHIVED"].includes(String(diagnostic?.status || "").toUpperCase());
}

export function diagnosticCanBeArchived(diagnostic = {}) {
  return String(diagnostic?.status || "").toUpperCase() !== "ARCHIVED";
}
