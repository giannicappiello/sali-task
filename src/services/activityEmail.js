import { supabase } from '../lib/supabaseClient.js';

export async function activityEmailRequest(input, { signal } = {}) {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data?.session?.access_token) throw new Error('Sessione scaduta. Accedi nuovamente a Workspace.');
  const response = await fetch('/api/mexal/automation?route=activity-email', {
    method: 'POST', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000),
    headers: { Authorization: `Bearer ${data.session.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.success !== true) {
    throw Object.assign(new Error(typeof payload.error === 'string' ? payload.error : 'Operazione email non completata. Aggiorna lo storico prima di procedere.'), { status: response.status, code: payload.code });
  }
  return payload;
}
