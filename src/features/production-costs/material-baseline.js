const numeric = value => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value)) ? Number(value) : null;
export const materialCode = value => String(value ?? "").trim().toUpperCase();
const validQuantity = row => numeric(row.quantity) !== null && Number(row.quantity) >= 0;

// Fill gaps with separately labelled historical evidence; never mutate snapshots,
// replace recorded prices, or use SL consumption as the planned formula.
export function materialBaseline(evidence) {
 const original = evidence.baseline?.materials || [];
 const historical = evidence.historicalBaseline?.materials || [];
 const byCode = new Map();
 for (const row of historical) {
  const code = materialCode(row.code);
  if (!code) continue;
  const rows = byCode.get(code) || [];
  rows.push(row); byCode.set(code, rows);
 }
 const originalCodes = new Set(original.map(row => materialCode(row.code)));
 const invalidCodes = new Set(original.filter(row => !validQuantity(row)).map(row => materialCode(row.code)));
 const recoverableCodes = new Set([...byCode].filter(([,rows]) => rows.every(validQuantity)).map(([code]) => code));
 let recovered = false;
 const rows = original.filter(row => !invalidCodes.has(materialCode(row.code)) || !recoverableCodes.has(materialCode(row.code))).map(row => ({...row}));
 for (const [code, historicalRows] of byCode) {
  if (originalCodes.has(code) && !invalidCodes.has(code)) continue;
  if (!historicalRows.every(validQuantity)) continue;
  // A partly missing lot split cannot be added to a whole-formula quantity.
  // Replace only that incomplete code group and disclose the reconstruction.
  const recordedRows = original.filter(row => materialCode(row.code) === code);
  const recordedPrices = recordedRows.map(row => numeric(row.unitCost));
  const recordedPrice = recordedPrices.length && recordedPrices.every(price => price !== null && price === recordedPrices[0]) ? recordedPrices[0] : null;
  for (const row of historicalRows) rows.push({...row, ...(recordedRows.length ? {unitCost: recordedPrice} : {}), reconstructed: true});
  recovered = true;
 }
 return {rows, recovered, complete: Boolean((evidence.historicalBaseline?.materialsComplete || evidence.baseline?.materialsComplete) && rows.length && rows.every(validQuantity))};
}
