// HTML time inputs use HH:mm; PostgreSQL time columns also return seconds.
export function beautyVisitStartsAt(date, time) {
  const value = String(time || '09:00').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') ||
      !/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,6})?)?$/.test(value)) {
    throw new Error('Data o ora della giornata non valida.');
  }
  return `${date}T${value.length === 5 ? `${value}:00` : value}`;
}
