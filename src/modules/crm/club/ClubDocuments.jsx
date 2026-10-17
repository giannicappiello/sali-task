import { useRef, useState } from 'react';
import { useAuth } from '../../../contexts/AuthContext';
import { supabase } from '../../../lib/supabaseClient';
import { CLUB_SCREENS, clubError } from './clubModel';
import useClubRpc from './useClubRpc';

function Editor({ row, source, canWrite, canPublish, onSaved }) {
  const [kind, setKind] = useState(row?.kind || source?.kind || 'program');
  const [title, setTitle] = useState(row?.title || source?.title || 'Regolamento Sali di Ischia Club');
  const [body, setBody] = useState(row?.body || source?.body || '');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const lock = useRef(false);
  const published = row?.status === 'published';
  async function action(publish = false) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError('');
    try {
      const result = publish ? await supabase.rpc('club_publish_document', { target_id: row.id, expected_updated_at: row.updated_at }) : await supabase.rpc('club_save_document', { document_kind: kind, document_title: title, document_body: body, target_id: row?.id || null, expected_updated_at: row?.updated_at || null });
      if (result.error) throw result.error;
      await onSaved(publish ? row.id : result.data);
    } catch (failure) { setError(clubError(failure)); }
    finally { lock.current = false; setBusy(false); }
  }
  return <section className="panel crm-panel"><h3>{published ? 'Versione pubblicata' : 'Bozza del documento'}</h3>{published && <p>Il testo accettato dai clienti rimane nello storico. Per aggiornarlo crea una nuova bozza.</p>}{error && <p role="alert" className="crm-message error">{error}</p>}<form className="club-form" onSubmit={e => { e.preventDefault(); void action(); }}><fieldset className="club-fields" disabled={published || !canWrite || busy}><div className="crm-form-grid"><label>Documento<select value={kind} onChange={e => setKind(e.target.value)}><option value="program">Regolamento del programma</option><option value="privacy">Informativa privacy</option></select></label><label>Titolo<input required maxLength={200} value={title} onChange={e => setTitle(e.target.value)} /></label></div><label>Testo<textarea required minLength={30} maxLength={50000} rows={24} value={body} onChange={e => setBody(e.target.value)} /></label></fieldset>{!published && canWrite && <button className="primary-action crm-primary" disabled={busy}>Salva bozza</button>}</form>{row && !published && canPublish && <div className="crm-modal-actions"><button type="button" className="secondary-action crm-secondary" disabled={busy || title !== row.title || body !== row.body || kind !== row.kind} onClick={() => void action(true)}>Pubblica versione salvata nell’app</button></div>}<p>Completa tutti i campi [[DA DEFINIRE]] prima della pubblicazione. I titoli possono iniziare con # o ##. La pubblicazione aggiorna la sezione Regolamento dell’app.</p></section>;
}

export default function ClubDocuments() {
  const { data, loading, error, reload } = useClubRpc('club_admin_documents');
  const { canUseScreen } = useAuth();
  const [selection, setSelection] = useState('latest'), [source, setSource] = useState(null);
  const versions = data || [];
  const row = selection === 'new' ? null : selection === 'latest' ? versions[0] : versions.find(item => item.id === selection);
  const canWrite = canUseScreen(CLUB_SCREENS.documents, 'scrittura');
  return <>{error && <p role="alert" className="crm-message error">{error}</p>}{loading ? <p>Caricamento documenti…</p> : !error && <><section className="panel crm-panel club-form"><div className="crm-toolbar"><label>Versioni<select value={selection === 'latest' ? row?.id || 'new' : selection} onChange={e => { setSelection(e.target.value); setSource(null); }}>{!versions.length && <option value="new">Nuovo documento</option>}{versions.map(item => <option key={item.id} value={item.id}>{item.kind === 'privacy' ? 'Privacy' : 'Regolamento'} · {item.status === 'published' ? 'Pubblicato' : 'Bozza'} · {new Date(item.created_at).toLocaleString('it-IT')}</option>)}{selection === 'new' && versions.length > 0 && <option value="new">Nuova bozza</option>}</select></label>{canWrite && <button className="secondary-action crm-secondary" onClick={() => { setSource(row); setSelection('new'); }}>Crea nuova bozza{row ? ' da questa versione' : ''}</button>}</div><p>I documenti pubblicati sono consultabili anche prima dell’accesso. Le iscrizioni si aprono dopo la pubblicazione di regolamento e privacy e la configurazione del responsabile CRM.</p></section><Editor key={row?.id || `new-${source?.id || ''}`} row={row} source={source} canWrite={canWrite} canPublish={canUseScreen(CLUB_SCREENS.documents, 'amministrazione')} onSaved={async id => { setSelection(id); setSource(null); await reload(); }} /></>}</>;
}
