import { useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { RefreshCw, Search } from 'lucide-react';
import { useAuth } from '../../../contexts/AuthContext';
import { supabase } from '../../../lib/supabaseClient';
import { CrmKpiDialog } from '../CrmKpiDetail';
import { formatDate, formatMoney } from '../crmConfig';
import { CLUB_SCREENS, DELIVERY_LABELS, MODE_LABELS, REQUEST_STATUS, clubError, requestActions } from './clubModel';
import useClubRpc from './useClubRpc';

export default function ClubRequests() {
  const { canUseScreen } = useAuth();
  const [params, setParams] = useSearchParams();
  const status = params.get('stato') ?? 'pending';
  const page = Math.max(0, Number.parseInt(params.get('pagina'), 10) || 0);
  const [search, setSearch] = useState(params.get('cerca') || '');
  const { data, error, loading, reload } = useClubRpc('club_admin_requests', { status_filter: status, search_text: params.get('cerca') || '', page_offset: page * 25, page_size: 25 });
  const [busy, setBusy] = useState('');
  const lock = useRef(false);
  const [feedback, setFeedback] = useState('');
  const [actionError, setActionError] = useState('');
  const [detail, setDetail] = useState(null);
  const [transition, setTransition] = useState(null);
  const [reference, setReference] = useState('');
  const canWrite = canUseScreen(CLUB_SCREENS.requests, 'scrittura');
  function update(values) { setParams(current => { const next = new URLSearchParams(current); Object.entries(values).forEach(([k, v]) => v === '' && k !== 'stato' ? next.delete(k) : next.set(k, String(v))); return next; }); }
  async function change(row, target, reason = '') {
    if (lock.current || !canWrite || loading) return;
    lock.current = true; setBusy(row.id); setActionError(''); setFeedback('');
    try {
      const { error: failure } = await supabase.rpc('club_transition_request', { target_id: row.id, target_status: target, reference: reason });
      if (failure) throw failure;
      setTransition(null); setDetail(null); setFeedback(target === 'approved' ? 'Richiesta approvata. Il budget resta riservato fino alla consegna o al pagamento.' : 'Richiesta aggiornata.');
      await reload();
    } catch (failure) { setActionError(clubError(failure)); }
    finally { setBusy(''); lock.current = false; }
  }
  function act(row, target) {
    if (['completed', 'cancelled', 'rejected', 'shipped'].includes(target)) { setReference(''); setActionError(''); setTransition({ row, target }); }
    else void change(row, target);
  }
  return <>
    <form className="crm-filters" onSubmit={event => { event.preventDefault(); update({ cerca: search.trim(), pagina: 0 }); }}>
      <label><Search size={18} /><input type="search" aria-label="Cerca richieste Club" maxLength={200} placeholder="Cliente, codice, premio o negozio" value={search} onChange={e => setSearch(e.target.value)} /></label>
      <select aria-label="Stato richiesta" value={status} onChange={e => update({ stato: e.target.value, pagina: 0 })}><option value="">Tutte le richieste</option><option value="processing">In lavorazione</option>{Object.entries(REQUEST_STATUS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
      <button type="submit" className="secondary-action crm-secondary">Cerca</button><button type="button" className="secondary-action crm-secondary" onClick={reload} disabled={loading || !!busy}><RefreshCw size={16} />Aggiorna</button>
    </form>
    {(error || actionError) && <div role="alert" className="crm-message error">{error || actionError}</div>}
    {feedback && <div role="status" className="crm-message">{feedback}</div>}
    {loading ? <div role="status" className="crm-loading">Caricamento richieste…</div> : !error && <>
      <div className="crm-table-wrap"><table className="crm-table club-request-table" data-column-controls="off"><thead><tr><th>Data e cliente</th><th>Richiesta</th><th>Budget</th><th>Ritiro / consegna</th><th>Stato</th><th>Azioni</th></tr></thead><tbody>{(data?.rows || []).map(row => <tr key={row.id}>
        <td>{formatDate(row.created_at)}<strong>{row.customer_name}</strong><small>{row.member_code}</small><small>{row.customer_email || '—'}</small></td>
        <td>{row.reward_name}<small>{MODE_LABELS[row.mode]}</small><small>Rif. {row.id}</small><button type="button" className="crm-table-action" onClick={() => setDetail(row)}>Dettagli</button></td>
        <td>{formatMoney(row.reserved_amount)}<small>Premio / rimborso: {formatMoney(row.amount)}</small>{Number(row.shipping_fee) > 0 && <small>Spedizione: {formatMoney(row.shipping_fee)} · {row.shipping_payment === 'wallet' ? 'inclusa nella riserva' : row.shipping_payment === 'company' ? 'a carico azienda' : 'pagamento separato'}</small>}</td>
        <td>{DELIVERY_LABELS[row.delivery_method]}<small>{row.store_name || row.store_code || (row.delivery_method === 'home' ? `${row.delivery_details?.city || ''} ${row.delivery_details?.postal_code || ''}` : '')}</small></td>
        <td>{REQUEST_STATUS[row.status]}{row.approved_at && <small>Approvata il {formatDate(row.approved_at)} da {row.approved_by_name || 'operatore Workspace'}</small>}</td>
        <td><div className="club-row-actions">{canWrite ? requestActions(row).map(([target, label]) => <button key={target} type="button" className={target === 'approved' ? 'primary-action crm-primary' : 'secondary-action crm-secondary'} disabled={!!busy} onClick={() => act(row, target)}>{busy === row.id ? 'Aggiornamento…' : label}</button>) : row.status === 'pending' ? <button type="button" className="primary-action crm-primary" disabled title="Permesso di scrittura necessario">APPROVA RICHIESTA</button> : null}{!requestActions(row).length && <span>Richiesta conclusa</span>}</div></td>
      </tr>)}</tbody></table>{!data?.rows?.length && <p className="crm-empty">Nessuna richiesta per i filtri selezionati.</p>}</div>
      <div className="crm-pagination"><span role="status">{data?.total || 0} richieste · Pagina {page + 1}</span><button type="button" disabled={!page || !!busy} onClick={() => update({ pagina: page - 1 })}>Precedente</button><button type="button" disabled={(page + 1) * 25 >= (data?.total || 0) || !!busy} onClick={() => update({ pagina: page + 1 })}>Successiva</button></div>
    </>}
    {detail && !transition && <CrmKpiDialog title="Dettaglio richiesta Club" subtitle={detail.id} onClose={() => setDetail(null)}><section className="panel crm-panel"><dl><div><dt>Cliente</dt><dd>{detail.customer_name} · {detail.member_code}</dd></div><div><dt>Premio / rimborso</dt><dd>{detail.reward_name}</dd></div><div><dt>Budget riservato</dt><dd>{formatMoney(detail.reserved_amount)}</dd></div><div><dt>Consegna</dt><dd>{DELIVERY_LABELS[detail.delivery_method]}</dd></div><div><dt>Negozio</dt><dd>{detail.store_name || detail.store_code || '—'}</dd></div><div><dt>Stato</dt><dd>{REQUEST_STATUS[detail.status]}</dd></div>{Object.entries(detail.delivery_details || {}).map(([key, value]) => <div key={key}><dt>{({ recipient: 'Destinatario', street: 'Indirizzo', city: 'Città', postal_code: 'CAP', country: 'Paese', iban: 'IBAN', notes: 'Note' })[key] || key}</dt><dd>{typeof value === 'string' ? value : JSON.stringify(value)}</dd></div>)}{detail.completion_reference && <div><dt>Riferimento / motivazione</dt><dd>{detail.completion_reference}</dd></div>}</dl></section><div className="crm-modal-actions">{canWrite && requestActions(detail).map(([target, label]) => <button type="button" key={target} className="primary-action crm-primary" disabled={!!busy} onClick={() => act(detail, target)}>{label}</button>)}</div></CrmKpiDialog>}
    {transition && <CrmKpiDialog title={transition.target === 'completed' ? 'Conferma consegna o pagamento' : transition.target === 'shipped' ? 'Registra spedizione' : 'Motivazione richiesta'} subtitle={transition.row.reward_name} onClose={() => { if (!busy) setTransition(null); }}><form className="club-form" onSubmit={e => { e.preventDefault(); void change(transition.row, transition.target, reference.trim()); }}>{actionError && <p role="alert" className="crm-message error">{actionError}</p>}<label>Riferimento o motivazione<input required maxLength={1000} value={reference} onChange={e => setReference(e.target.value)} placeholder={transition.target === 'completed' ? 'Riferimento di consegna o pagamento eseguito' : transition.target === 'shipped' ? 'Corriere e riferimento spedizione' : 'Motivo dell’annullamento o del rifiuto'} /></label>{transition.row.mode === 'money' && transition.target === 'completed' && <p>Conferma solo dopo aver eseguito il pagamento di {formatMoney(transition.row.amount)}. Questa azione ne registra l’esito.</p>}<button className="primary-action crm-primary" disabled={!!busy || !reference.trim()}>Conferma</button></form></CrmKpiDialog>}
  </>;
}
