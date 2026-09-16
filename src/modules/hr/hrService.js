import { supabase } from '../../lib/supabaseClient';

export async function hrRpc(name, args = {}) {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new Error(error.message || 'Servizio HR non disponibile');
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
