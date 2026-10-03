const key = value => String(value || '').trim().toLowerCase().replace(/[\s_-]/g, '');
const terminal = new Set(['completed','completata','completato','terminata','terminato','chiusa','chiuso','closed','conclusa','concluso','cancelled','annullata','annullato']);
const active = new Set(['running','suspended','closing','inprogress','inproduzione','inlavorazione','incorso','sospesa','sospeso','inpausa','inchiusura','chiusuraincorso','chiusuradacompletare']);
export function productionStatus(value, actualStart, actualEnd) {
  const normalized = key(value);
  if (terminal.has(normalized)) return value;
  return active.has(normalized) || actualStart && !actualEnd ? 'In Lavorazione' : value;
}
