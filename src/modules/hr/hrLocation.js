export function mapsSearchUrl(query) {
  return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(String(query).trim());
}
export function parseCoordinates(value) {
  const match = String(value || '').trim().match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
  if (!match) throw new Error('Incolla latitudine e longitudine separate da virgola, ad esempio 41.9028, 12.4964.');
  const latitude = Number(match[1]);
  const longitude = Number(match[2]);
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) throw new Error('Le coordinate non sono valide. Copia il punto esatto da Google Maps.');
  return { latitude, longitude };
}
