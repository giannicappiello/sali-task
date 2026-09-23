export function isStaleModuleError(error) {
  return /Failed to fetch dynamically imported module|Importing a module script failed|Loading chunk .* failed|Unable to preload CSS/i.test(String(error?.message || ''));
}

// Never reload a working session automatically after a deployment or outage.
export function recoverStaleModule(event, notify) {
  if (!isStaleModuleError(event.payload)) return false;
  notify();
  return true;
}

export async function loadModuleWithRecovery(importer, waitForRetry) {
  for (;;) {
    try { return await importer(); }
    catch (error) {
      if (!isStaleModuleError(error)) throw error;
      await waitForRetry();
    }
  }
}
