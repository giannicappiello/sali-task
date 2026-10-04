// Each fresh observation reaches the authoritative server, including poor accuracy
// for diagnostics. No boundary uncertainty, second sample or client exit delay.
export function shouldSendObservation(position, _attendance, _lastSent, now = Date.now()) {
  const { latitude, longitude, accuracy } = position.coords;
  return [latitude, longitude, accuracy, position.timestamp].every(Number.isFinite) && accuracy >= 0 &&
    Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180 &&
    now - position.timestamp <= 30000 && position.timestamp <= now + 5000;
}
