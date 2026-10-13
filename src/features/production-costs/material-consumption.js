import { materialCode } from "./material-baseline.js";
import { productRows } from "./packaging-evidence.js";

// MES historical withdrawals include both raw-material issues and the later
// filling issues. Identify the bulk transfer by BOM/document evidence, never by
// article prefixes. Preserve other ingredient/packaging costs and source snapshots.
export function materialConsumptionWithoutBulkTransfer(evidence, rows) {
 const bulkCodes=new Set([
  evidence.historicalPackaging?.bulkCode,
  ...(evidence.historicalProductConsumption||[]).filter(m=>m.kind==="Bulk").map(m=>m.code),
  ...productRows(evidence).filter(m=>m.kind==="Bulk").map(m=>m.code),
 ].map(materialCode).filter(Boolean));
 return rows.filter(m=>m.kind!=="Bulk"&&!bulkCodes.has(materialCode(m.code)));
}
