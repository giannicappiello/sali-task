export function confirmedProductionOrder(payload = {}) {
  const proposals = Array.isArray(payload?.proposals) ? payload.proposals : [];
  const proposal = proposals.find((item) => Number.isSafeInteger(Number(item?.productionOrderId)) && Number(item.productionOrderId) > 0);
  if (!proposal) return null;
  return {
    id: Number(proposal.productionOrderId),
    number: String(proposal.productionOrderNumber || "").trim() || null,
  };
}

export function diagnosticIsManageable(diagnostic = {}) {
  return !["RESOLVED", "IGNORED", "ARCHIVED"].includes(String(diagnostic?.status || "").toUpperCase());
}
