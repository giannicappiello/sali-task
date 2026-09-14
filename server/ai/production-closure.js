import { createProgremesClient } from "../progremes-readonly-client.js";

export async function findProductionForClosure(auth, orderNumber, client = createProgremesClient()) {
  const { data, error } = await auth.scoped.rpc("company_mes_ai_can_write");
  if (error || data !== true) throw Object.assign(new Error("Permesso operativo MES richiesto."), { status: 403 });
  const search = String(orderNumber || "").trim();
  if (!search || search.length > 100) throw new Error("Indicare il numero esatto della RdP/ordine.");
  const result = await client.request("production-progress", { search, pageSize: 100 });
  const items = result.items.filter(row => row.orderNumber.toUpperCase() === search.toUpperCase());
  if (result.total > 100) throw new Error("Ricerca troppo ampia: specificare il numero completo della RdP.");
  if (items.some(row => !row.productionId || !row.articleCode || row.scrapQuantity == null))
    throw new Error("Aggiornare ProgreMES: mancano gli identificativi necessari alla chiusura controllata.");
  return { items, note: "Identificativo productionId = lavorazione; productionOrderId = ordine. Non sono intercambiabili. Nessuna modifica eseguita." };
}

export function assertClosureSnapshot(input, rows) {
  const row = rows.find(item => item.productionId === input.productionId);
  if (!row || String(input.targetId) !== String(row.productionId) || input.productionOrderId !== row.productionOrderId ||
      input.orderNumber !== row.orderNumber || input.articleCode !== row.articleCode || input.phase !== row.phase ||
      input.expectedStatus !== row.status || input.expectedStart !== row.start ||
      input.expectedProducedQuantity !== row.producedQuantity || input.expectedScrapQuantity !== row.scrapQuantity)
    throw new Error("Identità o stato della lavorazione cambiati: rileggere MES e creare una nuova proposta.");
  if (!["InProduzione", "Sospeso"].includes(row.status) || !(row.producedQuantity > 0) || row.scrapQuantity < 0)
    throw new Error("La lavorazione deve essere avviata, aperta e avere quantità prodotta positiva.");
  if (row.phase === "Semilavorato" && (row.qualityStatus !== "Conforme" || row.releaseStatus !== "Deliberato"))
    throw new Error("La forzatura non salta il controllo qualità e la delibera QA.");
  if (input.slAndClAlreadyRegistered !== true || typeof input.reason !== "string" || !input.reason.trim() || input.reason.length > 1000)
    throw new Error("Confermare che SL e CL sono già registrati manualmente e specificare il motivo.");
}
