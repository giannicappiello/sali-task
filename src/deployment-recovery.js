// An open tab may still reference a chunk removed by a newer deployment.
// Retry once per stale URL, so a network outage cannot create a reload loop.
export function recoverStaleModule(event, location, storage, now = Date.now()) {
  const message = String(event.payload?.message || "");
  if (!/Failed to fetch dynamically imported module|Importing a module script failed|Loading chunk .* failed/i.test(message)) return false;
  const key = "workspace:module-reload";
  try {
    const previous = JSON.parse(storage.getItem(key) || "null");
    if (previous && now - previous.at < 60000) return false;
    storage.setItem(key, JSON.stringify({ at: now }));
  } catch { return false; }
  event.preventDefault();
  location.reload();
  return true;
}
