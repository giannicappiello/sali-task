function productCode(value) {
  return String(value || "").trim().toUpperCase();
}

function isImportLine(line) { return productCode(line?.codice_articolo || line?.productCode).startsWith("IMP"); }

export function buildAvailabilitySignature({ lines, customer, warehouse }) {
  const normalizedLines = (lines || [])
    .map((line) => ({ productCode: productCode(line.codice_articolo || line.productCode), quantity: Number(line.quantita ?? line.quantity) }))
    .sort((left, right) => left.productCode.localeCompare(right.productCode) || left.quantity - right.quantity);
  return JSON.stringify({
    customerCode: productCode(customer?.codice_cliente || customer),
    warehouse: String(warehouse ?? ""),
    lines: normalizedLines,
  });
}

export function getAvailabilityValidity({ availability, lines, customer, invalidated = false }) {
  if (!availability) return { valid: false, reason: "Verifica nuovamente le disponibilità prima di confermare l’ordine." };
  if (invalidated) return { valid: false, reason: "Verifica nuovamente le disponibilità prima di confermare l’ordine." };
  const currentSignature = buildAvailabilitySignature({ lines, customer, warehouse: availability.warehouse });
  if (availability.signature !== currentSignature) return { valid: false, reason: "Verifica nuovamente le disponibilità prima di confermare l’ordine." };
  const results = new Map((availability.lines || []).map((line) => [productCode(line.productCode), line]));
  if (results.size !== (lines || []).length || (lines || []).some((line) => {
    const result = results.get(productCode(line.codice_articolo));
    return !result || Number(result.requestedQuantity) !== Number(line.quantita);
  })) return { valid: false, reason: "Verifica nuovamente le disponibilità prima di confermare l’ordine." };
  if ((availability.lines || []).some((line) => line.status === "error")) return { valid: false, reason: "Verifica nuovamente le disponibilità prima di confermare l’ordine." };
  return { valid: true, reason: "" };
}

export function quantitiesForOrderLine(line, availability, confirm) {
  if (isImportLine(line)) return { quantita_disponibile: 0, quantita_ocm: 0, quantita_ocx: 0, quantita_oci: Number(line.quantita) || 0 };
  if (!confirm) {
    const confirmed = Math.min(Number(line.quantita), Math.max(0, Number(line.disponibilita)));
    return { quantita_disponibile: confirmed, quantita_ocm: confirmed, quantita_ocx: Math.max(0, Number(line.quantita) - confirmed), quantita_oci: 0 };
  }
  const result = (availability.lines || []).find((item) => productCode(item.productCode) === productCode(line.codice_articolo));
  if (!result || result.status === "error") throw new Error("Verifica nuovamente le disponibilità prima di confermare l’ordine.");
  return { quantita_disponibile: result.confirmedQuantity, quantita_ocm: result.confirmedQuantity, quantita_ocx: result.missingQuantity, quantita_oci: 0 };
}

export function buildAvailabilityPreview(orderLines, resultLines) {
  const results = new Map((resultLines || []).map((line) => [line.productCode, line]));
  return orderLines.reduce((preview, line) => {
    const result = results.get(String(line.codice_articolo || "").replace(/\s+/g, "").toUpperCase());
    if (!result) return preview;
    const item = { productCode: result.productCode, description: line.descrizione, requestedQuantity: result.requestedQuantity };
    if (isImportLine(line)) { preview.oci.push({ ...item, quantity: Number(line.quantita) || 0 }); return preview; }
    if (result.confirmedQuantity > 0) preview.ocm.push({ ...item, quantity: result.confirmedQuantity });
    if (result.missingQuantity > 0) preview.ocx.push({ ...item, quantity: result.missingQuantity });
    return preview;
  }, { ocm: [], ocx: [], oci: [] });
}
