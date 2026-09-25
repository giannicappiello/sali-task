// Display-only formatting: API dates, input values and identifiers remain unchanged.
export function displayDateFormatter(options = {}) {
  const { timeStyle, ...rest } = options;
  delete rest.dateStyle;
  if (rest.weekday && !rest.day && !rest.month && !rest.year && !options.dateStyle) return new Intl.DateTimeFormat('it-IT', options);
  const formatter = new Intl.DateTimeFormat('it-IT', {
    ...rest, day: '2-digit', month: '2-digit', year: 'numeric',
    ...(timeStyle ? { hour: '2-digit', minute: '2-digit', ...(timeStyle === 'medium' || timeStyle === 'long' ? { second: '2-digit' } : {}) } : {}),
  });
  return { format(value) { return formatter.format(value).replaceAll('/', '-'); }, formatToParts(value) { return formatter.formatToParts(value); } };
}
export function formatDisplayDate(value, options = {}) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : displayDateFormatter(options).format(date);
}
