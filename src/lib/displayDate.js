// Keep date-only and local planning values in their original calendar day.
export function displayDate(value, includeTime = false) {
  if (!value) return '—';
  const local = typeof value === 'string' && value.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?(?:$|:\d{2}(?:\.\d+)?$)/);
  if (local) return `${local[3]}-${local[2]}-${local[1]}${includeTime && local[4] ? ` ${local[4]}:${local[5]}` : ''}`;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  const parts = Object.fromEntries(new Intl.DateTimeFormat('it-IT', {
    timeZone: 'Europe/Rome', day: '2-digit', month: '2-digit', year: 'numeric',
    ...(includeTime ? { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' } : {}),
  }).formatToParts(date).map(part => [part.type, part.value]));
  return `${parts.day}-${parts.month}-${parts.year}${includeTime ? ` ${parts.hour}:${parts.minute}` : ''}`;
}
