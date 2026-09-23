import { workbenchRowSearchText } from "./rdp-workbench-state.js";

export const commercialStages = [
  ["all", "Tutti gli ordini"], ["evaluation", "OCT da valutare"], ["rdp", "RdP da confermare"],
  ["confirmed", "Confermati / attesa OP"], ["scheduling", "Da pianificare"], ["planned", "Pianificati"],
  ["production", "In produzione"], ["completed", "Completati / evasi"], ["blocked", "Bloccati"], ["history", "Storico"],
];
export const commercialStageLabel = stage => commercialStages.find(([code]) => code === stage)?.[1] || "Da verificare";
export const openDiagnostics = row => (row.diagnostics || []).filter(item => !["resolved", "ignored", "archived"].includes(String(item.status).toLowerCase()));
export const hasBlock = row => row.stage === "blocked" || openDiagnostics(row).some(item => ["blocking", "critical"].includes(String(item.severity).toLowerCase()));
const time = value => { const parsed = Date.parse(value); return Number.isFinite(parsed) ? parsed : null; };
export function deliveryState(row, now = new Date()) {
  if (["history", "completed"].includes(row.stage)) return null;
  const due = time(row.deliveryDate);
  if (due === null) return null;
  const endOfDay = new Date(due); endOfDay.setHours(23, 59, 59, 999);
  if (endOfDay.getTime() < now.getTime()) return "Consegna scaduta";
  const planned = time(row.plannedCompletionDate);
  if (planned !== null && planned > endOfDay.getTime()) return "Prevista oltre consegna";
  return null;
}
export function commercialCounts(rows, now = new Date()) {
  const active = rows.filter(row => !["history", "completed"].includes(row.stage));
  return { active: active.length, evaluation: active.filter(row => row.stage === "evaluation").length,
    production: active.filter(row => row.stage === "production").length, attention: active.filter(hasBlock).length,
    late: active.filter(row => deliveryState(row, now)).length };
}
export function selectCommercialRows(rows, { stage = "all", search = "", focus = "", sort = "delivery" } = {}, now = new Date()) {
  const needle = search.trim().toLocaleLowerCase("it-IT");
  const result = rows.filter(row => {
    if (stage === "all" ? row.stage === "history" : row.stage !== stage) return false;
    const haystack = [workbenchRowSearchText(row), row.rdpNumber ? `rdp${row.rdpNumber}` : "",
      ...(row.productionOrders || []).flatMap(order => [order.numeroOrdine, order.codiceArticolo, `op ${order.id}`])].join(" ").toLocaleLowerCase("it-IT");
    if (needle && !haystack.includes(needle)) return false;
    if (focus === "active" && ["history", "completed"].includes(row.stage)) return false;
    if (focus === "attention" && !hasBlock(row)) return false;
    if (focus === "late" && !deliveryState(row, now)) return false;
    return true;
  });
  return result.sort((a,b) => {
    if (sort === "customer") return String(a.customer || "").localeCompare(String(b.customer || ""), "it");
    const field = sort === "planned" ? "plannedCompletionDate" : "deliveryDate";
    return (time(a[field]) ?? Infinity) - (time(b[field]) ?? Infinity) || String(a.label).localeCompare(String(b.label), "it", {numeric:true});
  });
}
