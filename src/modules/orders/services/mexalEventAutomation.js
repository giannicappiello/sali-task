import { supabase } from "../../../lib/supabaseClient";

export async function runMexalEventAutomation(eventKey, context = {}, dryRun = false) {
  const { data: { session }, error } = await supabase.auth.getSession();
  if (error || !session?.access_token) throw new Error("Sessione scaduta. Effettua nuovamente l'accesso.");
  const response = await fetch("/api/mexal/run-event-automation", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify({ eventKey, context, dryRun }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.success === false) throw new Error(result.error || "Preparazione Mexal non riuscita.");
  return result;
}
