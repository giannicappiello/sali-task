export function productionCoaWorkspacePath({ productionId, articleCode, lotCode, productionOrderId } = {}) {
  const context = new URLSearchParams({ destination: "coa-produzioni" });
  if (Number(productionId) > 0) context.set("productionId", String(productionId));
  if (String(articleCode || "").trim()) context.set("article", String(articleCode).trim());
  if (String(lotCode || "").trim()) context.set("lot", String(lotCode).trim());
  if (Number(productionOrderId) > 0) context.set("odpId", String(productionOrderId));
  return `/produzione/${encodeURIComponent("progremes.Documenti")}?${context}`;
}
