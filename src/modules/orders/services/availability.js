export function buildAvailabilityPreview(orderLines, resultLines) {
  const results = new Map((resultLines || []).map((line) => [line.productCode, line]));
  return orderLines.reduce((preview, line) => {
    const result = results.get(String(line.codice_articolo || "").replace(/\s+/g, "").toUpperCase());
    if (!result) return preview;
    const item = { productCode: result.productCode, description: line.descrizione, requestedQuantity: result.requestedQuantity };
    if (result.confirmedQuantity > 0) preview.ocm.push({ ...item, quantity: result.confirmedQuantity });
    if (result.missingQuantity > 0) preview.ocx.push({ ...item, quantity: result.missingQuantity });
    return preview;
  }, { ocm: [], ocx: [] });
}
