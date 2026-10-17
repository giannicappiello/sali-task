import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import useAppUpdate from './useAppUpdate';
import './app-update.css';

export default function AppUpdate() {
  const { available, busy, error, update } = useAppUpdate();
  const [collapsed, setCollapsed] = useState(false);
  if (!available) return null;
  if (collapsed) return <div className="app-update-small"><button className="text-button" onClick={() => setCollapsed(false)}><RefreshCw size={15} />Aggiornamento disponibile</button></div>;
  return <aside className="app-update" aria-label="Aggiornamento Fidelity"><div role="status"><strong>Nuova versione disponibile</strong><p>Puoi continuare a usare la Fidelity. Prima di aggiornare, termina e salva le operazioni in corso: la pagina verrà ricaricata.</p>{error && <p role="alert">{error}</p>}</div><div className="app-update-actions"><button className="button primary" disabled={busy} onClick={update}><RefreshCw size={16} />{busy ? 'Aggiornamento…' : 'Aggiorna ora'}</button><button className="button" disabled={busy} onClick={() => setCollapsed(true)}>Più tardi</button></div></aside>;
}
