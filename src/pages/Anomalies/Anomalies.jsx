import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { supabase } from '../../lib/supabaseClient';
import './anomalies.css';
import RecipientSettings from './RecipientSettings';
const labels = { open: 'Aperta', acknowledged: 'Presa in carico', investigating: 'In analisi', waiting: 'In attesa', resolved: 'Risolta', dismissed: 'Archiviata' };
export default function Anomalies() {
 const { id } = useParams();
 const [data, setData] = useState(null), [error, setError] = useState(''), [status, setStatus] = useState(''), [offset, setOffset] = useState(0);
 const [recoveryResult,setRecoveryResult] = useState('');
 const [comment, setComment] = useState(''), [nextStatus, setNextStatus] = useState(''), [busy, setBusy] = useState(false), [review, setReview] = useState(null);
 useEffect(() => {
  let active = true;
  const load = async () => {
   setData(null); setError(''); setReview(null);
   const { data: session, error: sessionError } = await supabase.auth.getSession();
   if (sessionError || !session?.session) throw Error('Accedi nuovamente a Workspace.');
   const query = new URLSearchParams({ route: 'anomalies', offset: String(offset), ...(status ? { status } : {}), ...(id ? { id } : {}) });
   const response = await fetch('/api/mexal/automation?' + query, { headers: { Authorization: 'Bearer ' + session.session.access_token } });
   const result = await response.json();
   if (!response.ok) throw Error(result.error || 'Registro non disponibile.');
   if (active) setData(result);
  };
  load().catch(e => { if (active) setError(e.message); });
  return () => { active = false; };
 }, [id, status, offset]);
 const propose = async event => {
  event.preventDefault(); setBusy(true); setError('');
  try {
   const row = data.items[0], { data: session } = await supabase.auth.getSession();
   const input = { id: row.id, expectedVersion: row.version, ...(comment.trim() ? { comment: comment.trim() } : {}), ...(nextStatus ? { status: nextStatus } : {}) };
   const response = await fetch('/api/mexal/automation?route=anomalies', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + session.session.access_token }, body: JSON.stringify(input) });
   const result = await response.json();
   if (!response.ok) throw Error(result.error || 'Proposta non creata.');
   setReview(result.reviewUrl);
  } catch (e) { setError(e.message); } finally { setBusy(false); }
 };
 const recoverDelivery = async () => {
  if (busy || !data?.recoveryRun) return;
  setBusy(true);setError('');setRecoveryResult('');
  try {
   const {data:session} = await supabase.auth.getSession();
   if (!session.session) throw Error('Sessione Workspace non disponibile.');
   const response = await fetch('/api/mexal/automation?route=anomalies&action=recover_delivery',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+session.session.access_token},body:JSON.stringify({run_id:data.recoveryRun.id})});
   const result = await response.json();
   if (!response.ok) throw Error(result.error || 'Recupero non concluso. Verificare il registro prima di ripetere.');
   if (result.delivery?.status === 'accepted') setRecoveryResult(`Invio accettato dal server email per ${(result.delivery.deliveries.accepted || 0) + (result.delivery.deliveries.delivered || 0)} destinatari. Non attesta la consegna in casella.`);
   else setRecoveryResult(`Esito: ${result.delivery?.status || result.status}. ${result.delivery?.reason || result.reason || 'Verificare il registro consegne prima di ripetere.'}`);
  } catch(e) {setError(e.message);} finally {setBusy(false);}
 };
 return <main className="anomalies-page">
  <header><h1>Anomalie</h1><p>Registro centrale · Fabbisogni &amp; Planning · orizzonte 28 giorni</p></header>
  {error && <p role="alert">{error}</p>}
  {data?.dashboard && <div className="anomaly-dashboard" aria-label="Riepilogo anomalie autorizzate">{[['open','Aperte'],['critical','Critiche'],['high','Gravi'],['resolved','Risolte']].map(([key,label]) => <div key={key}><strong>{data.dashboard[key]}</strong><span>{label}</span></div>)}</div>}
  {data?.agent && <aside><strong>{data.agent.enabled ? 'Agente abilitato' : 'Agente non attivo'}</strong><p>Controllo previsto alle 07:00 Europe/Rome. {data.agent.readiness?.reason}</p></aside>}
  {data?.configuration && data.agent && <RecipientSettings key={data.agent.config_version} agent={data.agent} configuration={data.configuration} />}
  {!id && data?.recoveryRun && data?.agent?.enabled && <section aria-label="Recupero invio report">
   <p>Report del {data.recoveryRun.business_day}: recupera solo l’invio ai destinatari già configurati. Le email già tentate non saranno rigenerate.</p>
   <button type="button" disabled={busy} onClick={recoverDelivery}>{busy?'Verifica invio in corso…':'Recupera invio report di oggi'}</button>
   {recoveryResult && <p role="status">{recoveryResult}</p>}
  </section>}
  {!id && <label>Stato <select value={status} onChange={e => { setStatus(e.target.value); setOffset(0); }}><option value="">Tutti</option>{Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>}
  {!data && !error && <p role="status">Caricamento anomalie autorizzate…</p>}
  {data && <><p>{data.items.length} risultati in questa pagina. Visibilità secondo permessi e ambito Workspace.</p>
   {data.items.length === 0 && <p>{id ? 'Anomalia non disponibile nel tuo ambito.' : 'Nessuna anomalia visibile con questi filtri. Questo non attesta la completezza dei controlli.'}</p>}
   <div className="anomaly-grid">{data.items.map(row => <article key={row.id}>
    <div className="anomaly-meta">{row.severity} · {labels[row.status]} · {row.category}</div>
    <h2><Link to={'/anomalie/' + row.id}>{row.title}</Link></h2><p>{row.description}</p>
    <p>Ultima rilevazione: {new Date(row.last_seen_at).toLocaleString('it-IT')} · versione {row.version}</p>
    {id && <><h3>Evidenze</h3><pre>{JSON.stringify(row.evidence, null, 2)}</pre><h3>Intervento proposto</h3><p>{row.corrective_proposal?.description || 'Nessun intervento proposto.'}</p>
     <form onSubmit={propose}><label>Stato proposto <select value={nextStatus} onChange={e => setNextStatus(e.target.value)}><option value="">Mantieni stato</option>{Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>Commento <textarea value={comment} onChange={e => setComment(e.target.value)} maxLength={4000} /></label><button disabled={busy || (!comment.trim() && !nextStatus)}>Prepara proposta da approvare</button></form>
     {review && <p>Proposta creata, modifica ancora da approvare. <a href={review}>Apri revisione manuale Workspace</a></p>}
    </>}
   </article>)}</div>
   {id && <section><h2>Commenti e storico</h2>{data.history?.items.map(event => <p key={event.id}>{new Date(event.created_at).toLocaleString('it-IT')} · {event.kind} {event.body || ''}</p>)}{data.history?.nextOffset !== null && <p>Lo storico continua nelle pagine successive, consultabili da Progre AI.</p>}<Link to="/anomalie">Torna al registro</Link></section>}
   {!id && <nav aria-label="Pagine anomalie"><button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 50))}>Precedenti</button><button disabled={data.nextOffset === null} onClick={() => setOffset(data.nextOffset)}>Successive</button></nav>}
  </>}
 </main>;
}
