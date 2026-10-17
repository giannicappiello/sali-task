import { useCallback, useEffect, useRef, useState } from 'react';
import { Plus, RefreshCw } from 'lucide-react';
import { useAuth } from '../../../contexts/AuthContext';
import { supabase } from '../../../lib/supabaseClient';
import { loadAllQueryRows } from '../crmDataset';
import { CrmKpiDialog } from '../CrmKpiDetail';
import { formatDate, formatMoney } from '../crmConfig';
import { CLUB_SCREENS, DELIVERY_LABELS, clubError, localDateTime } from './clubModel';
import useClubRpc from './useClubRpc';

function RewardEditor({ reward, onClose, onSaved }) {
  const [form, setForm] = useState(() => ({ kind: reward.kind || 'products', product_id: reward.product_id || '', name: reward.name || '', description: reward.description || '', budget_required: reward.budget_required ?? '', stock: reward.stock ?? 0, active: reward.active ?? true, delivery_methods: reward.delivery_methods || ['pickup'], valid_until: reward.valid_until ? localDateTime(reward.valid_until) : '' }));
  const [products, setProducts] = useState([]);
  const [productsLoading, setProductsLoading] = useState(true);
  const [productError, setProductError] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const set = (key, value) => setForm(current => ({ ...current, [key]: value }));
  const loadProducts = useCallback(async () => {
    const result = await loadAllQueryRows((from, to) => supabase.from('prodotti').select('id,nome,codice_mexal').eq('attivo_mexal', true).eq('mostra_in_app', true).order('nome').order('id').range(from, to));
    if (result.error) throw result.error;
    return result.data || [];
  }, []);
  useEffect(() => {
    let active = true;
    loadProducts().then(rows => { if (active) setProducts(rows); }).catch(failure => { if (active) setProductError(clubError(failure)); }).finally(() => { if (active) setProductsLoading(false); });
    return () => { active = false; };
  }, [loadProducts]);
  async function save(event) {
    event.preventDefault(); if (saving.current) return;
    if (!form.delivery_methods.length) { setError('Seleziona almeno una modalità di consegna.'); return; }
    saving.current = true; setBusy(true); setError('');
    try {
      const payload = { ...form, name: form.name.trim(), product_id: form.kind === 'products' ? form.product_id : null, budget_required: Number(form.budget_required), stock: Number(form.stock), valid_until: form.valid_until ? new Date(form.valid_until).toISOString() : null };
      const { error: failure } = await supabase.rpc('club_save_reward', { payload, target_id: reward.id || null, expected_updated_at: reward.updated_at || null });
      if (failure) throw failure;
      await onSaved(); onClose();
    } catch (failure) { setError(clubError(failure)); }
    finally { saving.current = false; setBusy(false); }
  }
  return <CrmKpiDialog title={reward.id ? 'Modifica premio Club' : 'Nuovo premio Club'} onClose={() => { if (!busy) onClose(); }}><form className="club-form" onSubmit={save}>{error && <p role="alert" className="crm-message error">{error}</p>}<fieldset className="club-fields" disabled={busy}><div className="crm-form-grid"><label>Tipo<select value={form.kind} onChange={e => set('kind', e.target.value)}><option value="products">Prodotto Workspace</option><option value="prizes">Altro premio</option></select></label>{form.kind === 'products' && <label>Prodotto Workspace<select required value={form.product_id} disabled={productsLoading} onChange={e => { const item = products.find(product => product.id === e.target.value); setForm(current => ({ ...current, product_id: e.target.value, name: item?.nome || current.name })); }}><option value="">{productsLoading ? 'Caricamento prodotti…' : 'Seleziona un prodotto'}</option>{reward.product_id && !products.some(product => product.id === reward.product_id) && <option value={reward.product_id}>{reward.name} · prodotto già associato</option>}{products.map(product => <option key={product.id} value={product.id}>{product.nome} · {product.codice_mexal}</option>)}</select></label>}<label>Nome premio<input required maxLength={200} value={form.name} onChange={e => set('name', e.target.value)} /></label><label>Budget richiesto (€)<input required type="number" min="0.01" step="0.01" value={form.budget_required} onChange={e => set('budget_required', e.target.value)} /></label><label>Quantità disponibile<input required type="number" min="0" step="1" value={form.stock} onChange={e => set('stock', e.target.value)} /></label><label>Disponibile fino al<input type="datetime-local" value={form.valid_until} onChange={e => set('valid_until', e.target.value)} /></label></div><label>Descrizione<textarea maxLength={4000} value={form.description} onChange={e => set('description', e.target.value)} /></label><div className="club-checks">{['pickup', 'home'].map(value => <label key={value}><input type="checkbox" checked={form.delivery_methods.includes(value)} onChange={e => set('delivery_methods', e.target.checked ? [...form.delivery_methods, value] : form.delivery_methods.filter(mode => mode !== value))} />{DELIVERY_LABELS[value]}</label>)}<label><input type="checkbox" checked={form.active} onChange={e => set('active', e.target.checked)} />Premio attivo</label></div></fieldset>{productError && <p role="alert" className="crm-message error">Catalogo prodotti: {productError}</p>}<div className="crm-modal-actions"><button type="submit" className="primary-action crm-primary" disabled={busy || (form.kind === 'products' && !form.product_id)}>{busy ? 'Salvataggio…' : 'Salva premio'}</button></div></form></CrmKpiDialog>;
}

export default function ClubRewards() {
  const { canUseScreen } = useAuth();
  const { data, error, loading, reload } = useClubRpc('club_admin_rewards');
  const [editor, setEditor] = useState(null);
  const [message, setMessage] = useState('');
  const canWrite = canUseScreen(CLUB_SCREENS.rewards, 'scrittura');
  return <>
    <div className="crm-toolbar"><p>I prodotti restano collegati al catalogo Workspace.</p><div className="crm-toolbar-actions"><button type="button" className="secondary-action crm-secondary" onClick={reload} disabled={loading}><RefreshCw size={16} />Aggiorna</button>{canWrite && <button type="button" className="primary-action crm-primary" onClick={() => setEditor({})}><Plus size={16} />Nuovo premio</button>}</div></div>
    {error && <div role="alert" className="crm-message error">{error}</div>}{message && <div role="status" className="crm-message">{message}</div>}
    {loading ? <div className="crm-loading">Caricamento premi…</div> : !error && <div className="crm-table-wrap"><table className="crm-table" data-column-controls="off"><thead><tr><th>Premio</th><th>Budget necessario</th><th>Disponibilità</th><th>Consegna</th><th>Validità</th><th>Azioni</th></tr></thead><tbody>{(data || []).map(reward => <tr key={reward.id}><td><strong>{reward.name}</strong><small>{reward.kind === 'products' ? 'Prodotto Workspace' : 'Altro premio'} · {reward.active ? 'Attivo' : 'Sospeso'}</small>{reward.description && <small>{reward.description}</small>}</td><td>{formatMoney(reward.budget_required)}</td><td>{reward.stock}</td><td>{reward.delivery_methods.map(mode => DELIVERY_LABELS[mode]).join(' / ')}</td><td>{reward.valid_until ? formatDate(reward.valid_until) : 'Senza scadenza'}</td><td>{canWrite && <button type="button" className="crm-table-action" onClick={() => setEditor(reward)}>Modifica</button>}</td></tr>)}</tbody></table>{!data?.length && <p className="crm-empty">Nessun premio configurato.</p>}</div>}
    {editor && <RewardEditor reward={editor} onClose={() => setEditor(null)} onSaved={async () => { setMessage('Premio salvato.'); await reload(); }} />}
  </>;
}
