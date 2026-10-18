import { supabase } from './client';
export async function supplyOrder(input) {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data?.session?.access_token) throw Object.assign(new Error('Accedi come negozio per generare un ordine.'), { status: 401 });
  const response = await fetch('/api/club-supply-order', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session.access_token}` }, body: JSON.stringify(input) });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(result.error || 'Invio non confermato. Riprova con lo stesso ordine.'), { status: response.status });
  return result;
}
