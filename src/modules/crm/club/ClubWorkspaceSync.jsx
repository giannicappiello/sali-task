import { useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useAuth } from '../../../contexts/AuthContext';
import { supabase } from '../../../lib/supabaseClient';
import { CLUB_SCREENS, clubError } from './clubModel';

export default function ClubWorkspaceSync({ onSynced }) {
  const { canUseScreen } = useAuth();
  const running = useRef(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  if (!canUseScreen(CLUB_SCREENS.catalog, 'scrittura')) return null;
  async function synchronize() {
    if (running.current) return;
    running.current = true;
    setBusy(true); setMessage(''); setError('');
    try {
      const { data, error: failure } = await supabase.rpc('club_sync_workspace_catalog');
      if (failure) throw failure;
      setMessage(`Sincronizzazione completata: ${data.products} prodotti, ${data.documents} documenti e ${data.images} immagini disponibili. Nuovi prodotti: ${data.added_products}; nuovi collegamenti: ${data.linked_documents}.`);
      onSynced?.();
    } catch (failure) { setError(clubError(failure)); }
    finally { running.current = false; setBusy(false); }
  }
  return <>
    <button type="button" className="secondary-action crm-secondary" disabled={busy} aria-busy={busy} onClick={() => void synchronize()}><RefreshCw size={16} />{busy ? 'Sincronizzazione in corso…' : 'Sincronizza prodotti e documenti'}</button>
    {message && <span role="status">{message}</span>}
    {error && <span className="crm-message error" role="alert">{error}</span>}
  </>;
}