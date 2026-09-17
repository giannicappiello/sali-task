export const CALENDAR_DAYS = ['Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato', 'Domenica'];
export const isoWeekday = day => new Date(`${day}T12:00:00Z`).getUTCDay() || 7;
export function calendarWeek(calendar, day) {
  const version = calendar?.versions.filter(v => v.effectiveFrom <= day).sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom)).at(-1);
  return structuredClone(version?.week || Object.fromEntries(CALENDAR_DAYS.map((_, i) => [String(i + 1), []])));
}
export function validateSlots(slots) {
  const sorted = slots.map(slot => [...slot]).sort((a, b) => a[0].localeCompare(b[0]));
  if (sorted.some(([from, to], i) => !/^([01]\d|2[0-3]):[0-5]\d$/.test(from) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(to) || from >= to || (i > 0 && from < sorted[i - 1][1]))) throw new Error('Inserisci fasce valide, senza sovrapposizioni.');
  return sorted;
}
export function calendarSavePayload(calendar, draft) {
  const slots = draft.open ? validateSlots(draft.slots) : [];
  if (draft.open && !slots.length) throw new Error('Aggiungi almeno una fascia oraria oppure imposta il giorno come chiuso.');
  if (draft.scope === 'day') return { p_action: 'exception', p_data: { day: draft.day, intervals: slots, reason: draft.note.trim() || (slots.length ? 'Orario aziendale modificato' : 'Chiusura aziendale') } };
  if (calendar.versions.some(v => v.effectiveFrom === draft.day)) throw new Error('Esiste già una versione con questa decorrenza. Modifica il solo giorno oppure scegli una nuova decorrenza in Orario settimanale.');
  const week = calendarWeek(calendar, draft.day);
  week[String(isoWeekday(draft.day))] = slots;
  if (!Object.values(week).some(s => s.length)) throw new Error('La settimana deve avere almeno una fascia lavorativa. Per una chiusura usa il singolo giorno.');
  return { p_action: 'version', p_data: { effectiveFrom: draft.day, week, note: draft.note.trim() || `Nuovo orario del ${CALENDAR_DAYS[isoWeekday(draft.day) - 1].toLowerCase()}` } };
}
export function missingScheduleCount(data, day) {
  return data.employees.filter(e => e.active).filter(e => {
    if (data.shifts.some(s => s.user_id === e.user_id && s.work_date === day)) return false;
    const c = data.contracts.filter(c => c.user_id === e.user_id && c.effective_from <= day).sort((a, b) => b.effective_from.localeCompare(a.effective_from) || (b.created_at || '').localeCompare(a.created_at || '')).at(0);
    return !c || !c.site_id || !c.start_time || !c.end_time || c.break_minutes == null || !c.weekdays?.length;
  }).length;
}
