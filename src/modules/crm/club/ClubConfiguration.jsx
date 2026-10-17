import { useRef, useState } from 'react';
import { useAuth } from '../../../contexts/AuthContext';
import { supabase } from '../../../lib/supabaseClient';
import { CrmKpiDialog } from '../CrmKpiDetail';
import { formatDate, formatMoney } from '../crmConfig';
import { CLUB_SCREENS, DELIVERY_LABELS, MODE_LABELS, cashbackPreview, clubError, configurationForm, configurationPayload } from './clubModel';
import useClubRpc from './useClubRpc';

function ConfigurationEditor({ row, canWrite, canPublish, onSaved, onMessage }) {
  const [form, setForm] = useState(() => configurationForm(row));
  const [spend, setSpend] = useState('40');
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const [error, setError] = useState('');
  const [publishing, setPublishing] = useState(false);
  const published = row?.status === 'published';
  const editable = canWrite && !published;
  const set = (key, value) => setForm(current => ({ ...current, [key]: value }));
  const toggle = (key, value, checked) => setForm(current => ({ ...current, [key]: checked ? [...current[key], value] : current[key].filter(item => item !== value) }));
  async function save(event) {
    event.preventDefault(); if (saving.current || !editable) return;
    saving.current = true; setBusy(true); setError('');
    try {
      const payload = configurationPayload(form);
      const { data, error: failure } = await supabase.rpc('club_save_configuration', { payload, target_id: row?.id || null, expected_updated_at: row?.updated_at || null });
      if (failure) throw failure;
      onMessage('Bozza salvata. Per renderla attiva occorre pubblicarla.'); await onSaved(data);
    } catch (failure) { setError(clubError(failure)); }
    finally { saving.current = false; setBusy(false); }
  }
  async function publish() {
    if (saving.current || !row?.id || !canPublish) return;
    saving.current = true; setBusy(true); setError('');
    try {
      const { error: failure } = await supabase.rpc('club_publish_configuration', { target_id: row.id, expected_updated_at: row.updated_at });
      if (failure) throw failure;
      setPublishing(false); onMessage('Configurazione pubblicata. Sarà applicata agli acquisti dalla decorrenza indicata.'); await onSaved(row.id);
    } catch (failure) { setError(clubError(failure)); }
    finally { saving.current = false; setBusy(false); }
  }
  const generated = cashbackPreview(spend, form.cashback_percent);
  return <>
    {published && <div className="crm-message">Versione pubblicata e conservata nello storico. Crea una nuova bozza per modificare le regole.</div>}
    {error && <div role="alert" className="crm-message error">{error}</div>}
    <form className="club-form" onSubmit={save}>
      <section className="panel crm-panel"><h3>Accumulo cashback</h3><fieldset disabled={!editable || busy} className="club-fields"><div className="crm-form-grid"><label>Nome configurazione<input required maxLength={120} value={form.name} onChange={e => set('name', e.target.value)} /></label><label>Percentuale cashback (%)<input required type="number" min="0" max="100" step="0.01" value={form.cashback_percent} onChange={e => set('cashback_percent', e.target.value)} /></label><label>Decorrenza<input type="datetime-local" value={form.effective_at} onChange={e => set('effective_at', e.target.value)} /></label></div></fieldset><p>La percentuale si applica all’importo effettivamente pagato dei prodotti del programma. Il cashback viene arrotondato al centesimo per acquisto.</p><div className="crm-form-grid"><label>Simula una spesa valida (€)<input type="number" min="0" step="0.01" value={spend} onChange={e => setSpend(e.target.value)} /></label><div className="club-calculation" aria-live="polite"><span>Budget accumulato</span><strong>{generated == null ? '—' : formatMoney(generated)}</strong></div></div></section>
      <section className="panel crm-panel"><h3>Modalità di rimborso</h3><fieldset disabled={!editable || busy} className="club-fields"><div className="club-checks">{Object.entries(MODE_LABELS).map(([value, label]) => <label key={value}><input type="checkbox" checked={form.reimbursement_modes.includes(value)} onChange={e => toggle('reimbursement_modes', value, e.target.checked)} />{label}</label>)}</div>{form.reimbursement_modes.includes('money') && <div className="crm-form-grid"><label>Rimborso minimo in denaro (€)<input required type="number" min="0" step="0.01" value={form.cash_minimum} onChange={e => set('cash_minimum', e.target.value)} /></label><label>Modalità di pagamento<select value={form.cash_method} onChange={e => set('cash_method', e.target.value)}><option value="bank_transfer">Bonifico bancario</option><option value="store_cash">Contanti al negozio di fiducia</option></select></label></div>}</fieldset></section>
      <section className="panel crm-panel"><h3>Ritiro e spedizione</h3><fieldset disabled={!editable || busy} className="club-fields"><div className="club-checks">{['pickup', 'home'].map(value => <label key={value}><input type="checkbox" checked={form.delivery_methods.includes(value)} onChange={e => toggle('delivery_methods', value, e.target.checked)} />{DELIVERY_LABELS[value]}</label>)}</div>{form.delivery_methods.includes('home') && <div className="crm-form-grid"><label>Costo spedizione (€)<input required type="number" min="0" step="0.01" value={form.shipping_fee} onChange={e => set('shipping_fee', e.target.value)} /></label><label>Pagamento spedizione<select value={form.shipping_payment} onChange={e => set('shipping_payment', e.target.value)}><option value="company">A carico azienda</option><option value="wallet">Con budget cashback</option><option value="separate">Pagamento separato</option></select></label><label>Spedizione gratuita da (€ di premio)<input type="number" min="0" step="0.01" placeholder="Nessuna soglia" value={form.free_shipping_threshold} onChange={e => set('free_shipping_threshold', e.target.value)} /></label></div>}</fieldset><p>Ogni premio può prevedere solo il ritiro, solo la spedizione o entrambe le possibilità, entro le modalità abilitate qui.</p></section>
      {editable && <div className="crm-modal-actions"><button type="submit" className="primary-action crm-primary" disabled={busy}>{busy ? 'Salvataggio…' : 'Salva bozza'}</button></div>}
    </form>
    {row?.id && row.status === 'draft' && canPublish && <section className="panel crm-panel"><h3>Pubblicazione</h3><p>La pubblicazione utilizza la versione salvata. Le modifiche al modulo devono essere salvate prima di procedere.</p><button type="button" className="primary-action crm-primary" disabled={busy || !row.effective_at} onClick={() => { setError(''); setPublishing(true); }}>Rivedi e pubblica versione salvata</button></section>}
    {publishing && <CrmKpiDialog title="Pubblica configurazione Club" subtitle="Riepilogo della versione salvata" onClose={() => { if (!busy) setPublishing(false); }}><section className="panel crm-panel"><dl><div><dt>Nome</dt><dd>{row.name}</dd></div><div><dt>Cashback</dt><dd>{row.cashback_percent}%</dd></div><div><dt>Decorrenza</dt><dd>{new Date(row.effective_at).toLocaleString('it-IT')}</dd></div><div><dt>Rimborsi</dt><dd>{row.reimbursement_modes.map(mode => MODE_LABELS[mode]).join(', ')}</dd></div><div><dt>Consegne</dt><dd>{row.delivery_methods.map(mode => DELIVERY_LABELS[mode]).join(', ') || 'Solo denaro'}</dd></div><div><dt>Spedizione</dt><dd>{formatMoney(row.shipping_fee)}</dd></div></dl></section><p>Gli acquisti precedenti e le richieste già inviate conservano le proprie condizioni.</p>{error && <p role="alert" className="crm-message error">{error}</p>}<div className="crm-modal-actions"><button type="button" className="primary-action crm-primary" disabled={busy} onClick={publish}>Conferma pubblicazione</button></div></CrmKpiDialog>}
  </>;
}

export default function ClubConfiguration() {
  const { canUseScreen } = useAuth();
  const { data, error, loading, reload } = useClubRpc('club_admin_configuration');
  const [selectedId, setSelectedId] = useState('latest');
  const [message, setMessage] = useState('');
  const [copySource, setCopySource] = useState(null);
  const versions = data?.versions || [];
  const row = selectedId === 'new' ? null : selectedId === 'latest' ? versions[0] : versions.find(version => version.id === selectedId);
  const canWrite = canUseScreen(CLUB_SCREENS.configuration, 'scrittura');
  const canPublish = canUseScreen(CLUB_SCREENS.configuration, 'amministrazione');
  const saved = async id => { setSelectedId(id); setCopySource(null); await reload(); };
  return <>
    {error && <div role="alert" className="crm-message error">{error}</div>}
    {message && <div role="status" className="crm-message">{message}</div>}
    {loading ? <div className="crm-loading">Caricamento configurazione…</div> : !error && <>
      <div className="crm-toolbar"><label>Versione<select value={row?.id || 'new'} onChange={e => { setSelectedId(e.target.value); setCopySource(null); setMessage(''); }}><option value="new">Nuova bozza</option>{versions.map(version => <option key={version.id} value={version.id}>{version.name} · {version.status === 'draft' ? 'Bozza' : 'Pubblicata'} · {formatDate(version.created_at)}</option>)}</select></label>{canWrite && <button type="button" className="secondary-action crm-secondary" onClick={() => { setCopySource(row || null); setSelectedId('new'); setMessage(''); }}>{row ? 'Crea nuova bozza da questa versione' : 'Nuova bozza'}</button>}</div>
      <ConfigurationEditor key={row ? `${row.id}-${row.updated_at}` : `new-${copySource?.id || 'empty'}`} row={row || (copySource ? { ...copySource, id: null, status: 'draft', effective_at: null } : null)} canWrite={canWrite} canPublish={canPublish} onSaved={saved} onMessage={setMessage} />
    </>}
  </>;
}
