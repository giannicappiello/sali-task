import { useLocation } from 'react-router-dom';
import {useEffect,useId,useRef,useState} from 'react';
import {createClient} from '@supabase/supabase-js';
import {useAuth} from '../../contexts/AuthContext';
import './second-brain.css';

async function brainRequest(session,body,online=false){
 const response=await fetch(online?'/api/second-brain/oauth/connection':'/api/mexal/automation?route=second-brain',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${session.access_token}`},body:JSON.stringify(body)});
 const result=await response.json();if(!response.ok||result.success===false)throw Error(result.error||'Collegamento non disponibile.');return result;
}
const authorization=()=>Object.fromEntries([...new URLSearchParams(location.search)].filter(([key])=>['client_id','redirect_uri','response_type','code_challenge','code_challenge_method','state','resource','scope'].includes(key)));
export function OnlineConsent(){
 const {session}=useAuth();const[preview,setPreview]=useState(null),[password,setPassword]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const framed=window.top!==window.self;
 useEffect(()=>{if(!session||framed)return;let active=true;brainRequest(session,{action:'preview',authorization:authorization()},true).then(value=>{if(active)setPreview(value);}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[session,framed]);
 const grant=async event=>{
  event.preventDefault();if(!preview||busy)return;setBusy(true);setError('');let temporary,accepted=false;
  try{
   temporary=createClient(import.meta.env.VITE_SUPABASE_URL,import.meta.env.VITE_SUPABASE_ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false,storageKey:'second-brain-consent-temporary'}});
   const result=await temporary.auth.signInWithPassword({email:session.user.email,password});setPassword('');
   if(result.error||!result.data.session)throw Error('Accesso Workspace non riuscito. Verifica la password e gli eventuali requisiti aggiuntivi.');
   if(result.data.user.id!==session.user.id)throw Error('Utente diverso da quello che sta autorizzando il collegamento.');
   const connected=await brainRequest(result.data.session,{action:'grant',authorization:preview.authorization,expectedUserId:preview.identity.id,refreshToken:result.data.session.refresh_token},true);
   accepted=true;window.location.assign(connected.redirect);
  }catch(e){setError(e.message);setBusy(false);}finally{setPassword('');if(temporary&&!accepted)await temporary.auth.signOut({scope:'local'}).catch(()=>{});}
 };
 if(framed)return <section className="second-brain-page"><h1>Collega Second Brain</h1><p>Per autorizzare il collegamento apri questa pagina in una finestra separata.</p><a href={location.href} target="_blank" rel="noopener noreferrer">Apri collegamento sicuro</a></section>;
 return <section className="second-brain-page"><h1>Collega Second Brain a Codex</h1><p>{preview?`Utente Workspace: ${preview.identity.name}`:'Verifica del collegamento…'}</p><p>ChatGPT / Codex potrà consultare i dati e la memoria consentiti al tuo utente e preparare proposte. Le modifiche richiederanno la tua conferma in Workspace. Nessun programma viene installato sul PC.</p><p>Per mantenere separato il collegamento dalla normale sessione Workspace, conferma una volta il tuo accesso personale.</p>{error&&<p role="alert">{error}</p>}{preview&&<form onSubmit={grant}><label>Email Workspace<input type="email" value={session.user.email} readOnly autoComplete="username"/></label><label>Password Workspace<input type="password" value={password} onChange={e=>setPassword(e.target.value)} required autoComplete="current-password"/></label><div className="second-brain-actions"><button disabled={busy}>{busy?'Collegamento…':'Autorizzo il collegamento personale'}</button><a href="/assistente-ai">Annulla</a></div></form>}<p>Puoi revocare il collegamento dalla pagina Second Brain. La password viene inviata solo all’autenticazione Workspace e non viene salvata.</p></section>;
}
export function OnlineReview() {
 const { session } = useAuth();
 const { search } = useLocation();
 const query = new URLSearchParams(search), kind = query.get('kind'), id = query.get('proposalId');
 return <OnlineReviewContent key={`${session?.user?.id || ''}:${kind}:${id}`} session={session} kind={kind} id={id} />;
}

const CHAT_EMAIL_SCOPE = 'Autorizzi Progre AI a inviare per tuo conto singole email di testo con il mittente aziendale configurato, soltanto quando lo chiedi espressamente in chat e ai destinatari indicati nella richiesta. Non autorizzi messaggi automatici, ricorrenti, massivi o allegati. Puoi revocare la delega.';
const EMAIL_ERROR_LABELS = {
 provider_rejected: 'Il servizio email ha rifiutato il messaggio.',
 transport_uncertain: 'Il servizio non ha confermato l’esito. Verifica prima di richiedere un nuovo invio.',
 lease_expired: 'La verifica dell’invio è scaduta. L’esito resta incerto.',
};

function OnlineReviewContent({ session, kind, id }) {
 const [prepared, setPrepared] = useState(null), [outcome, setOutcome] = useState(null), [error, setError] = useState(''), [submitted, setSubmitted] = useState(false);
 const [consent, setConsent] = useState(false);
 const consentId = useId();
 const pending = useRef(false);
 const live = useRef(false);
 const framed = window.top !== window.self;
 const isDelegation = kind === 'email-delegation';
 useEffect(() => {
  live.current = true;
  return () => { live.current = false; };
 }, []);
 useEffect(() => {
  if (!session || framed) return;
  let active = true;
  brainRequest(session, { action: 'confirmation', kind, id }).then(value => { if (active) setPrepared(value); }).catch(e => { if (active) setError(e.message); });
  return () => { active = false; };
 }, [session, kind, id, framed]);
 const delegation = isDelegation ? outcome?.delegation || prepared?.proposal : null;
 const supportedPolicy = delegation?.policy_version === 'chat-email-v1' && Boolean(delegation?.policy_hash);
 const delegationPending = delegation?.status === 'proposed';
 const canRevoke = isDelegation && delegation?.status === 'active' && prepared?.mode === 'revoke';
 const decide = async decision => {
  if (pending.current || submitted || prepared?.terminal || !prepared?.receipt) return;
  if (isDelegation && !(canRevoke && decision === 'reject') && (!delegationPending || (decision === 'confirm' && (!consent || !supportedPolicy)))) return;
  pending.current = true; setSubmitted(true); setError('');
  try {
   const result = await brainRequest(session, { action: 'decide', receipt: prepared.receipt, decision });
   if (live.current) setOutcome(result);
  } catch {
   if (live.current) setError(isDelegation
    ? 'Esito dell’autorizzazione da verificare. Riapri questo riepilogo o chiedi a Progre AI di leggere lo stato della delega prima di ripetere.'
    : 'Esito da verificare nello storico prima di ripetere. Riapri questo riepilogo o chiedi a Progre AI di leggere lo stato.');
  }
 };
 if (framed) return <section className="second-brain-page"><h1>Conferma operazione</h1><a href={location.href} target="_blank" rel="noopener noreferrer">Apri il riepilogo in una finestra separata</a></section>;
 const email = kind === 'email' ? outcome?.email || prepared?.proposal : null;
 const labels = { proposed: 'Da confermare', queued: 'Accodata', sending: 'Invio in corso', accepted: 'Accettata dal server', uncertain: 'Esito incerto: verifica necessaria', failed: 'Invio non riuscito', rejected: 'Rifiutata', cancelled: 'Annullata' };
 const delegationLabels = { proposed: 'Da autorizzare', active: 'Attiva', revoked: 'Non attiva (revocata o non autorizzata)' };
 const showDecision = prepared && !prepared.terminal && !outcome && (!isDelegation || delegationPending || canRevoke);
 return <section className="second-brain-page">
  <h1>{isDelegation ? canRevoke ? 'Gestisci la delega email' : 'Autorizza le email richieste in chat' : kind === 'email' ? 'Conferma email' : 'Conferma operazione Second Brain'}</h1>
  {error && <p role="alert">{error}</p>}
  {!session && <p>Accedi a Workspace con il tuo account personale per verificare questa richiesta.</p>}
  {prepared && <>
   <p>Utente: {prepared.identity?.name || session.user.email}</p>
   {isDelegation ? <article aria-label="Ambito dell’autorizzazione email">
    <p>{CHAT_EMAIL_SCOPE}</p>
    <p>Questa attivazione personale si esegue una sola volta. Dopo l’attivazione, gli invii coperti dalla delega non richiedono di aprire una task o confermare ogni email in questa pagina.</p>
    <p><strong>Stato:</strong> {delegationLabels[delegation?.status] || 'Stato da verificare'}</p>
    {delegationPending && !supportedPolicy && <p role="alert">Questa versione dell’autorizzazione non è riconosciuta. Non può essere attivata da questa pagina.</p>}
   </article> : email ? <article aria-label="Riepilogo email da approvare">
    <p><strong>Destinatario:</strong> {email.recipient}</p><p><strong>Oggetto:</strong> {email.subject}</p>
    <p><strong>Testo:</strong></p><div style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{email.body}</div>
    <p><strong>Stato:</strong> {labels[email.status] || 'Stato da verificare'}</p>
    <p>L’accettazione da parte del server non dimostra la consegna al destinatario.</p>
    {email.error_code && <p role="status">{EMAIL_ERROR_LABELS[email.error_code] || 'Il servizio ha segnalato un problema. Controlla lo storico prima di ripetere l’invio.'}</p>}
   </article> : <pre>{JSON.stringify(outcome || prepared.proposal, null, 2)}</pre>}
   {showDecision && (canRevoke ? <div className="second-brain-actions">
    <button type="button" disabled={submitted || !prepared.receipt} onClick={() => decide('reject')}>Revoca delega email</button>
   </div> : <>
    {isDelegation ? <label htmlFor={consentId} style={{ display: 'flex', flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
     <input id={consentId} type="checkbox" checked={consent} disabled={submitted || !supportedPolicy} onChange={event => setConsent(event.target.checked)} style={{ width: 'auto', flexShrink: 0, marginTop: 4 }} />
     <span>Ho letto l’ambito della delega e autorizzo gli invii richiesti espressamente in chat.</span>
    </label> : <p>{email ? 'Controlla destinatario, oggetto e testo. Confermando autorizzi questa email e la inserisci nella coda di invio.' : 'Verifica la proposta completa e la situazione precedente. Questa conferma autorizza la modifica dei dati aziendali.'}</p>}
    <div className="second-brain-actions">
     <button type="button" disabled={submitted || !prepared.receipt || (isDelegation && (!consent || !supportedPolicy))} onClick={() => decide('confirm')}>{isDelegation ? 'Autorizzo gli invii richiesti in chat' : email ? 'Conferma e invia email' : 'Confermo questa operazione'}</button>
     <button type="button" disabled={submitted || !prepared.receipt} onClick={() => decide('reject')}>{isDelegation ? 'Non autorizzo' : 'Rifiuta'}</button>
    </div>
   </>)}
  </>}
  {outcome && <p role="status">{isDelegation
   ? outcome.delegation?.status === 'active' ? 'Delega attiva. Puoi richiedere singoli invii direttamente in chat.' : 'Decisione registrata. La delega non risulta attiva.'
   : email ? 'Decisione registrata. Consulta lo storico per l’esito del servizio email.' : 'Decisione registrata. Torna a Codex e verifica il risultato persistito prima di proseguire.'}</p>}
 </section>;
}
