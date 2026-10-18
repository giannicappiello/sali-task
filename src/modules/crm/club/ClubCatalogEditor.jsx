import ClubCatalogOrder from './ClubCatalogOrder';
import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useAuth } from '../../../contexts/AuthContext';
import { supabase } from '../../../lib/supabaseClient';
import { CrmKpiDialog } from '../CrmKpiDetail';
import { CLUB_SCREENS, clubError } from './clubModel';
import useClubRpc from './useClubRpc';
import { categoryLabel } from './catalogModel';
import ClubMediaPicker, { CatalogPager } from './ClubMediaPicker';

function ProductForm({ entry, categories, onClose, onSaved, canWrite }) {
  const [form, setForm] = useState(entry), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const set = (key, value) => setForm(current => ({ ...current, [key]: value }));
  async function save(event) {
    event.preventDefault();if (busy) return;setBusy(true);setError('');
    try {
      const { error: failure } = await supabase.rpc('club_save_catalog_product', { target_id: entry.id, expected_updated_at: entry.updated_at, payload: { name: form.name, description: form.description, visible: form.visible, category_ids: form.category_ids, document_ids: form.media.map(row => row.id), cover_id: form.media.find(row => row.cover)?.id || null } });
      if (failure) throw failure;await onSaved();onClose();
    } catch (failure) { setError(clubError(failure)); } finally { setBusy(false); }
  }
  return <form className="club-form" onSubmit={save}>{error && <p className="crm-message error" role="alert">{error}</p>}<fieldset className="club-fields club-editor-fields" disabled={busy || !canWrite}><div className="crm-form-grid"><label>Codice Workspace<input value={entry.code} readOnly /></label><label>Nome pubblico<input required maxLength={250} value={form.name} onChange={e => set('name', e.target.value)} /></label></div><label>Descrizione<textarea rows={6} maxLength={30000} value={form.description} onChange={e => set('description', e.target.value)} /></label><div className="club-checks"><label><input type="checkbox" checked={form.visible} onChange={e => set('visible', e.target.checked)} />Visibile nel catalogo Club</label></div><h3>Classificazione come salidischia.it</h3><div className="club-category-options">{categories.map(row => <label key={row.id}><input type="checkbox" checked={form.category_ids.includes(row.id)} onChange={e => set('category_ids', e.target.checked ? [...form.category_ids, row.id] : form.category_ids.filter(id => id !== row.id))} />{categoryLabel(row, categories)}</label>)}</div><ClubMediaPicker media={form.media} onChange={media => set('media', media)} productId={entry.id} readOnly={!canWrite} /></fieldset>{canWrite && <div className="crm-modal-actions"><button type="submit" disabled={busy} className="primary-action crm-primary">{busy ? 'Salvataggio…' : 'Salva prodotto Club'}</button></div>}</form>;
}
function ProductEditor({ id, categories, onClose, onSaved, canWrite }) {
  const { data, error, loading } = useClubRpc('club_editor_entry', { editor_kind: 'products', target_id: id });
  return <CrmKpiDialog title="Prodotto Club" onClose={onClose}>{error && <p className="crm-message error" role="alert">{error}</p>}{loading ? <p>Caricamento prodotto…</p> : data ? <ProductForm entry={data} categories={categories} onClose={onClose} onSaved={onSaved} canWrite={canWrite} /> : <p>Prodotto non disponibile.</p>}</CrmKpiDialog>;
}
export default function ClubCatalogEditor() {
  const { canUseScreen } = useAuth();const canWrite = canUseScreen(CLUB_SCREENS.catalog, 'scrittura');
  const [input, setInput] = useState(''), [search, setSearch] = useState(''), [page, setPage] = useState(0), [editor, setEditor] = useState(null), [message, setMessage] = useState(''), [ordering, setOrdering] = useState(false);
  const { data, error, loading, reload } = useClubRpc('club_editor_data', { editor_kind: 'products', search_text: search, page_offset: page * 25 });
  const taxonomy = useClubRpc('club_catalog_categories');
  return <><div className="crm-toolbar"><form onSubmit={e => { e.preventDefault();setSearch(input.trim());setPage(0); }} className="crm-toolbar-actions"><input type="search" aria-label="Cerca prodotti Club" placeholder="Nome o codice prodotto" maxLength={200} value={input} onChange={e => setInput(e.target.value)} /><button className="secondary-action crm-secondary">Cerca</button></form>{canWrite && <button type="button" className="secondary-action crm-secondary" onClick={() => setOrdering(true)}>Ordine nel Club</button>}<button type="button" className="secondary-action crm-secondary" disabled={loading} onClick={reload}><RefreshCw size={16} />Aggiorna</button></div><p>I prodotti provengono da Workspace. Le categorie del sito sono abbinate tramite codice SKU esatto; completa qui i prodotti da classificare. Foto principali e libreria documentale restano quelle di Workspace.</p>{message && <p className="crm-message" role="status">{message}</p>}{(error || taxonomy.error) && <p className="crm-message error" role="alert">{error || taxonomy.error}</p>}{loading ? <p>Caricamento catalogo…</p> : <div className="crm-table-wrap"><table className="crm-table" data-column-controls="off"><thead><tr><th>Prodotto</th><th>Classificazione</th><th>Visibilità</th><th>Azioni</th></tr></thead><tbody>{data?.rows?.map(row => <tr key={row.id}><td><strong>{row.name}</strong><small>{row.code}</small></td><td>{row.category_ids.length ? row.category_ids.map(id => categoryLabel(taxonomy.data?.find(item => item.id === id), taxonomy.data || [])).join(' · ') : 'Da classificare'}</td><td>{row.visible ? 'Visibile' : 'Nascosto'}</td><td><button type="button" className="crm-table-action" onClick={() => setEditor(row.id)}>{canWrite ? 'Modifica' : 'Dettagli'}</button></td></tr>)}</tbody></table>{!data?.rows?.length && <p className="crm-empty">Nessun prodotto trovato.</p>}</div>}<CatalogPager page={page} total={data?.total} onPage={setPage} />{ordering && <ClubCatalogOrder onClose={() => setOrdering(false)} onSaved={async text => { await reload();setMessage(text); }} />}{editor && <ProductEditor id={editor} categories={taxonomy.data || []} canWrite={canWrite} onClose={() => setEditor(null)} onSaved={async () => { await reload();setMessage('Prodotto Club aggiornato.'); }} />}</>;
}
