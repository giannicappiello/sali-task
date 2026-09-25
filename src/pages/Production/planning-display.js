import { displayDateFormatter } from '../../lib/displayLocale.js';
export const planningStages = { FORECAST: "Previsione", CONFIRMED: "Piano confermato", RELEASED: "ODL rilasciato", HISTORICAL: "Storico", CANCELLED: "Annullata", PRESERVED: "Conservata", IN_PROGRESS: "In produzione" };
export const planningStatuses = { PROPOSED: "Da confermare", APPLIED: "Applicata", PREPARING: "Preparazione lotti", RECONCILIATION_REQUIRED: "Da riconciliare", RELEASED: "Rilasciato", RELEASED_WITH_SHORTAGE: "Rilasciato con carenza · fabbisogno da coprire", IN_PROGRESS: "In produzione", CANCELLED: "Annullato", COMPLETED: "Completato" };
export function planningDate(value, fallback = "Non disponibile") {
  if (!value) return fallback;
  // MES planning dates have wall-clock Italian semantics; UTC audit dates have a Z suffix.
  const local = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::[\d.]+)?$/.exec(value);
  if (local) return `${local[3]}/${local[2]}/${local[1]} ${local[4]}:${local[5]}`;
  return displayDateFormatter({ timeZone: "Europe/Rome", dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}
