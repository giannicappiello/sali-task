export const FREQUENCIES = Object.freeze({ manual: null, every_15_minutes: 15, every_30_minutes: 30, hourly: 60, every_2_hours: 120, every_6_hours: 360, every_12_hours: 720, daily: 1440, weekly: 10080, custom_daily: null });
const romeParts = (date) => Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Rome", weekday: "short", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date).filter(({ type }) => type !== "literal").map(({ type, value }) => [type, value]));
export function nextRunAt(frequency, from = new Date(), configuration = {}) {
  const interval = FREQUENCIES[frequency];
  if (interval) return new Date(from.getTime() + interval * 60000).toISOString();
  if (frequency !== "custom_daily") return null;
  const hour = Math.max(0, Math.min(23, Number(configuration.hour ?? 0))), minute = Math.max(0, Math.min(59, Number(configuration.minute ?? 0)));
  const days = Array.isArray(configuration.days) && configuration.days.length ? configuration.days : null;
  // Search UTC instants, compare Rome wall-clock parts: correct for CET/CEST and skips nonexistent DST times.
  for (let step = 1; step <= 8 * 24 * 60; step += 1) { const candidate = new Date(from.getTime() + step * 60000); const p = romeParts(candidate); if (Number(p.hour) === hour && Number(p.minute) === minute && (!days || days.includes(p.weekday))) return candidate.toISOString(); }
  return null;
}
export async function executeActionChain({ actions = [], executeAction, isStopped = async () => false }) { const results = []; for (let index = 0; index < actions.length; index += 1) { const action = actions[index]; if (await isStopped()) return { status: "stopped", results }; try { const result = await executeAction(action, index); results.push({ action_type: action.type, status: result?.status || "completed", result: result?.result || {} }); if (result?.status === "failed" && action.blocking !== false) return { status: "failed", results, error: result.error || "Azione bloccante non completata." }; } catch (error) { results.push({ action_type: action.type, status: "failed", error: error.message }); if (action.blocking !== false) return { status: "failed", results, error: error.message }; } } return { status: "completed", results }; }
