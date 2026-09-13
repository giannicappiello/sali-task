// Production status only. Economic completeness must never affect this filter.
const key = value => String(value || "").toLowerCase().replace(/[\s_/-]/g, "");
const terminal = new Set(["completato", "chiuso", "terminato"]);
export const workflowOptions = [
  ["open", "Aperte (tutte)"], ["new", "Da avviare"],
  ["planned", "Pianificate"], ["running", "In produzione"],
  ["paused", "Sospese"], ["closed", "Concluse"], ["cancelled", "Annullate"],
];
export function productionWorkflow(record) {
  const order = key(record.state);
  if (order === "annullato") return "cancelled";
  if (terminal.has(order)) return "closed";
  const works = (record.works || record.phases || []).filter(w => key(w.state) !== "annullato");
  if (works.some(w => key(w.state) === "inproduzione")) return "running";
  if (works.some(w => key(w.state) === "sospeso")) return "paused";
  // A completed mixing phase does not close an order awaiting filling.
  if (order === "inproduzione") return "running";
  if (order === "pianificato") return "planned";
  if (order === "nuovo") return "new";
  if (works.length && works.every(w => terminal.has(key(w.state)))) return "closed";
  if (works.some(w => key(w.state) === "pianificato")) return "planned";
  if (works.some(w => key(w.state) === "daavviare")) return "new";
  return "unknown";
}
export function matchesWorkflow(record, selection) {
  if (!selection) return true;
  const status = productionWorkflow(record);
  return selection === "open" ? ["new", "planned", "running", "paused"].includes(status) : status === selection;
}
export function workflowLabel(record) {
  const status = productionWorkflow(record);
  return ({new: "Da avviare", planned: "Pianificata", running: "In produzione",
    paused: "Sospesa", closed: "Conclusa", cancelled: "Annullata"})[status] || record.state || "Stato non disponibile";
}
