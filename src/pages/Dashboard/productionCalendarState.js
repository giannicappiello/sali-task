import { displayDateFormatter } from '../../lib/displayLocale.js';
export const emptyProductionCalendar = () => ({ items: [], loading: false, error: '', warning: '', enabled: false, valid: false });

export function calendarFailure(previous, error) {
  if ([401, 403].includes(error.status)) return { ...emptyProductionCalendar(), error: error.message, enabled: true };
  return previous.valid
    ? { ...previous, loading: false, stale: true, warning: "Aggiornamento MES non riuscito: è mostrato l'ultimo calendario valido.", error: '' }
    : { ...emptyProductionCalendar(), error: error.message, enabled: true };
}

export function calendarNotModified(previous) {
  return { ...previous, loading: false, error: '', stale: false, warning: previous.serverWarning || '' };
}

export function calendarUpdatedLabel(updatedAt) {
  if (!updatedAt || !Number.isFinite(Date.parse(updatedAt))) return '';
  return displayDateFormatter({ timeZone: 'Europe/Rome', dateStyle: 'short', timeStyle: 'medium' }).format(new Date(updatedAt));
}
