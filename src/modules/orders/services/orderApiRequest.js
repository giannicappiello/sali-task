import { mexalAuthenticatedRequest } from "../../integrations/services/mexalAuthenticatedRequest.js";

export async function postOrderJson(url, body, { supabase, fetchImpl = globalThis.fetch }) {
  const response = await mexalAuthenticatedRequest(url, body, {
    fetchImpl,
    getToken: async ({ refresh }) => {
      const { data, error } = await (refresh ? supabase.auth.refreshSession() : supabase.auth.getSession());
      if (error || !data?.session?.access_token) throw Object.assign(
        new Error("Sessione scaduta. Effettua nuovamente l'accesso."), { status: 401 });
      return data.session.access_token;
    },
  });
  const raw = await response.text();
  let payload;
  try { payload = raw ? JSON.parse(raw) : {}; }
  catch { payload = { error: raw || "Risposta API non valida." }; }
  if (!response.ok) throw Object.assign(new Error(payload.error || `Errore API (${response.status}).`), { status: response.status });
  return payload;
}
