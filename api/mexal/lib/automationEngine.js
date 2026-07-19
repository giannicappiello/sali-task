export const FREQUENCIES = Object.freeze({
  manual: null, every_15_minutes: 15, every_30_minutes: 30, hourly: 60,
  every_2_hours: 120, every_6_hours: 360, every_12_hours: 720,
  daily: 1440, weekly: 10080, custom_daily: null,
});

export function nextRunAt(frequency, from = new Date(), configuration = {}) {
  const minutes = FREQUENCIES[frequency];
  if (minutes) return new Date(from.getTime() + minutes * 60000).toISOString();
  if (frequency !== "custom_daily") return null;
  const hour = Math.min(23, Math.max(0, Number(configuration.hour || 0)));
  const minute = Math.min(59, Math.max(0, Number(configuration.minute || 0)));
  // The scheduler stores the configured Rome wall-clock time as an ISO instant.
  // Intl lets this remain correct across CET/CEST without relying on browser timers.
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Rome", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(from);
  const get = (type) => parts.find((part) => part.type === type)?.value;
  const local = new Date(`${get("year")}-${get("month")}-${get("day")}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00`);
  if (local <= from) local.setDate(local.getDate() + 1);
  return local.toISOString();
}

export async function executeActionChain({ actions = [], executeAction, isStopped = async () => false }) {
  const results = [];
  for (let index = 0; index < actions.length; index += 1) {
    const action = actions[index];
    if (await isStopped()) return { status: "stopped", results };
    try {
      const result = await executeAction(action, index);
      results.push({ action_type: action.type, status: result?.status || "completed", result: result?.result || {} });
      if (result?.status === "failed" && action.blocking !== false) return { status: "failed", results, error: result.error || "Azione bloccante non completata." };
    } catch (error) {
      results.push({ action_type: action.type, status: "failed", error: error.message });
      if (action.blocking !== false) return { status: "failed", results, error: error.message };
    }
  }
  return { status: "completed", results };
}
