import {useEffect,useState} from 'react';

export default function CommercialReportResend({batch,request,onUpdated}) {
 const [state,setState]=useState(null),[accepted,setAccepted]=useState({}),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 async function refresh(){setState(await request(null,batch.id));}
 useEffect(()=>{let active=true;request(null,batch.id).then(s=>{if(active)setState(s);}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[batch.id,request]);
 async function resend(email){
  setBusy(true);setError('');setMessage('');
  try{await request({action:'resend',batchId:batch.id,emailId:email.id,claimedAt:email.claimed_at,requestId:crypto.randomUUID(),acceptDuplicate:accepted[email.id]===true,reason:'Il titolare richiede esplicitamente un nuovo invio dopo verifica della mancata ricezione, accettando possibili duplicati.'});setAccepted({});await refresh();await onUpdated();setMessage('Nuovo tentativo autorizzato e accodato. Aggiorna lo stato per verificarne l’esito.');}
  catch(e){setError(e.message+' Aggiorna lo stato prima di riprovare.');}finally{setBusy(false);}
 }
 return <section className="panel" style={{padding:20,marginBottom:20}}>
  <h2>Invii del lotto {batch.period}</h2>
  {error&&<p role="alert">{error}</p>}{message&&<p role="status">{message}</p>}
  <button disabled={busy} onClick={()=>refresh().catch(e=>setError(e.message))}>Aggiorna esiti email</button>
  {state&&<p>{state.files.length} PDF finalizzati su {batch.manifest.length}. {state.emails.filter(e=>e.status==='sent').length} email confermate su {state.emails.length}.</p>}
  {state?.emails.map(email=><div key={email.id} style={{margin:'12px 0'}}>
   <p>{email.recipient}: {email.status}{email.sent_at&&` — ${new Date(email.sent_at).toLocaleString('it-IT')}`}</p>
   {!!email.parts?.length&&<p>Messaggi numerati: {email.parts.filter(p=>p.status==='sent').length} confermati su {email.parts[0].total}. {email.parts.map(p=>`${p.part+1}/${p.total}: ${p.status}`).join(' · ')}</p>}
   {email.last_error&&<p>Ultimo errore: {email.last_error}</p>}
   {email.status==='uncertain'&&<>
    <p>Un esito incerto può includere un invio riuscito senza conferma. Prima controlla le caselle e il registro del servizio. Il reinvio è disponibile dopo 10 minuti dal tentativo.</p>
    <label><input type="checkbox" disabled={busy} checked={accepted[email.id]===true} onChange={e=>setAccepted(s=>({...s,[email.id]:e.target.checked}))}/> Ho verificato l’esito e richiedo il reinvio a {email.recipient}, accettando possibili duplicati.</label>
    <button disabled={busy||!accepted[email.id]} onClick={()=>resend(email)}>Reinvia a {email.recipient}</button>
   </>}
  </div>)}
 </section>;
}
