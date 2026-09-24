import { supabase } from '../../lib/supabaseClient';

export async function hrNetwork(body) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('Accedi nuovamente a Workspace.');
  const response = await fetch('/api/workspace/hr', { method: body ? 'POST' : 'GET', cache: 'no-store',
    headers: { Authorization: `Bearer ${session.access_token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || 'Verifica della rete aziendale non disponibile.');
  return result;
}

const RPC_SCHEMA_CACHE_ERROR = /could not find the function|schema cache|function .* does not exist/i;

export async function hrRpc(name, args = {}) {
  const { data, error } = await supabase.rpc(name, args);
  if (error) {
    if (RPC_SCHEMA_CACHE_ERROR.test(error.message || '')) {
      const signature = name === 'workspace_hr_admin_request' ? 'p_data jsonb' : 'contratto RPC HR previsto dalla migrazione';
      throw new Error(`Il servizio HR non è allineato in produzione (RPC ${name}, firma attesa: ${signature}). Contatta l’amministratore: la migrazione HR deve essere applicata e lo schema PostgREST ricaricato.`);
    }
    throw new Error(error.message || 'Servizio HR non disponibile');
  }
  return data;
}

export function positionPayload(position) {
  return { latitude: position.coords.latitude, longitude: position.coords.longitude,
    accuracy: position.coords.accuracy, sampled_at: new Date(position.timestamp).toISOString() };
}

export function locate() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('Geolocalizzazione non disponibile su questo dispositivo.'));
    navigator.geolocation.getCurrentPosition((p) => resolve(positionPayload(p)), () => reject(new Error('Posizione non disponibile. Consenti la posizione precisa per Workspace e riprova.')),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 });
  });
}

export { romeDay, monthDays, formatTime, formatDate, timeInput, romeInstant, attendanceAnomaly } from './hrTime';
