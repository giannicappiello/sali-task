import { supabase } from "../../../lib/supabaseClient";

async function request(action, payload = {}, method = "POST") {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error("Sessione Workspace non disponibile.");
  const response = await fetch("/api/crm/digital-connections", {
    method,
    headers: { authorization: `Bearer ${session.access_token}`, "content-type": "application/json" },
    body: method === "GET" ? undefined : JSON.stringify({ action, ...payload }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.success === false) throw new Error(result.error || "Operazione Connection Manager non riuscita.");
  return result;
}

export const digitalConnectionsService = Object.freeze({
  list: () => request("list"),
  operational: (id = null) => request("operational", id ? { id } : {}),
  save: (payload) => request("save", payload),
  test: (id) => request("test", { id }),
  activate: (id, syncFrequency) => request("activate", { id, syncFrequency }),
  deactivate: (id) => request("deactivate", { id }),
  syncNow: (id) => request("sync_now", { id }),
  revokeSecret: (id, secretName) => request("revoke_secret", { id, secretName }),
  saveMapping: (payload) => request("save_mapping", payload),
  oauthStart: (id) => request("oauth_start", { id }),
});
