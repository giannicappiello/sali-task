// Client throttling only. The server independently validates every GPS observation.
export function shouldSendObservation(position, attendance, lastSent, now = Date.now()) {
  const { latitude, longitude, accuracy } = position.coords;
  if (![latitude, longitude, accuracy, position.timestamp].every(Number.isFinite) || accuracy < 0 || accuracy > 50 ||
      Math.abs(latitude) > 90 || Math.abs(longitude) > 180 || now - position.timestamp > 30000 || position.timestamp > now + 5000) return false;
  const radians = x => x * Math.PI / 180;
  const a = Math.sin(radians(attendance.site_latitude - latitude) / 2) ** 2 +
    Math.cos(radians(latitude)) * Math.cos(radians(attendance.site_latitude)) * Math.sin(radians(attendance.site_longitude - longitude) / 2) ** 2;
  const distance = 6371000 * 2 * Math.asin(Math.min(1, Math.sqrt(a)));
  return distance - accuracy > attendance.checkout_radius || now - lastSent >= 15000;
}
