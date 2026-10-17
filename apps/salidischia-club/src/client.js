import { createClient } from '@supabase/supabase-js';
const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
if (!url || !key) throw Error('Configurazione Club non disponibile.');
export const supabase = createClient(url, key, { auth: { storageKey: 'salidischia-club-session', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' } });
export async function rpc(name, parameters = {}) {
  const { data, error } = await supabase.rpc(name, parameters);
  if (error) throw error;
  return data;
}
export const money = value => Number(value || 0).toLocaleString('it-IT', { style: 'currency', currency: 'EUR' });
export const date = value => new Date(value).toLocaleDateString('it-IT');
export const statusLabel = { pending: 'Da approvare', approved: 'Approvata', ready: 'Pronta al ritiro', shipped: 'Spedita', completed: 'Completata', cancelled: 'Annullata', rejected: 'Rifiutata', confirmed: 'Confermato', reversed: 'Stornato' };
export const modeLabel = { products: 'Prodotti', prizes: 'Premi', money: 'Denaro' };
export const deliveryLabel = { pickup: 'Nel negozio di fiducia', home: 'A casa', bank_transfer: 'Bonifico bancario', store_cash: 'Contanti nel negozio di fiducia' };
export function message(error) { return error?.message || 'Operazione non riuscita. Controlla la connessione e riprova.'; }
