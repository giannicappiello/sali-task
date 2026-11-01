import {useEffect,useState} from 'react';
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
export function OnlineReview(){
 const {session}=useAuth();const[prepared,setPrepared]=useState(null),[outcome,setOutcome]=useState(null),[error,setError]=useState(''),[submitted,setSubmitted]=useState(false);
 const query=new URLSearchParams(location.search),kind=query.get('kind'),id=query.get('proposalId');const framed=window.top!==window.self;
 useEffect(()=>{if(!session||framed)return;let active=true;brainRequest(session,{action:'confirmation',kind,id}).then(value=>{if(active)setPrepared(value);}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[session,kind,id,framed]);
 const decide=async decision=>{if(submitted||!prepared?.receipt)return;setSubmitted(true);try{setOutcome(await brainRequest(session,{action:'decide',receipt:prepared.receipt,decision}));}catch{setError('Esito da verificare in Codex con BRAIN_ACTION_STATUS. Non ripetere la modifica.');}};
 if(framed)return <section className="second-brain-page"><h1>Conferma operazione</h1><a href={location.href} target="_blank" rel="noopener noreferrer">Apri il riepilogo in una finestra separata</a></section>;
 return <section className="second-brain-page"><h1>Conferma operazione Second Brain</h1>{error&&<p role="alert">{error}</p>}{prepared&&<><p>Utente: {prepared.identity?.name||session.user.email}</p><pre>{JSON.stringify(outcome||prepared.proposal,null,2)}</pre>{!prepared.terminal&&!outcome&&<><p>Verifica la proposta completa e la situazione precedente. Questa conferma autorizza la modifica dei dati aziendali.</p><div className="second-brain-actions"><button disabled={submitted} onClick={()=>decide('confirm')}>Confermo questa operazione</button><button disabled={submitted} onClick={()=>decide('reject')}>Rifiuta</button></div></>}</>}{outcome&&<p>Decisione registrata. Torna a Codex e verifica il risultato persistito prima di proseguire.</p>}</section>;
}
