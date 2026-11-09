import {useEffect,useState} from 'react';
import {Link} from 'react-router-dom';
import {supabase} from '../../lib/supabaseClient';
async function request(body){
 const {data:{session}}=await supabase.auth.getSession();if(!session)throw Error('Accedi nuovamente a Workspace.');
 const r=await fetch('/api/mexal/automation?route=margin-reports',{method:body?'POST':'GET',headers:{Authorization:'Bearer '+session.access_token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
 const x=await r.json();if(!r.ok)throw Error(x.error||'Operazione non conclusa.');return x;
}
export default function MarginReportDelivery(){
 const [plan,setPlan]=useState(null),[review,setReview]=useState(null),[checked,setChecked]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 async function load(){setPlan(await request());}
 useEffect(()=>{let active=true;request().then(x=>active&&setPlan(x)).catch(e=>active&&setError(e.message));return()=>{active=false;};},[]);
 async function run(action,id){setBusy(true);setError('');try{
  if(action==='review'){setReview(await request({action:'confirmation',runId:id}));setChecked(false);}
  if(action==='activate'){const r=await request({action:'activate',receipt:review.receipt,confirmPlan:true});setMessage(r.message);setReview(null);await load();}
  if(action==='pdf'){const r=await request({action:'pdf',runId:id}),bytes=Uint8Array.from(atob(r.file.base64),c=>c.charCodeAt(0));const url=URL.createObjectURL(new Blob([bytes],{type:'application/pdf'}));const a=document.createElement('a');a.href=url;a.download=r.file.filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);}
  if(action==='refresh')await load();
 }catch(e){setError(e.message);}finally{setBusy(false);}}
 return <main className="page" style={{maxWidth:1000,margin:'0 auto',padding:24}}>
  <Link to="/settings/ai">Configurazione AI</Link><h1>Report marginalità lavorazioni</h1>
  <p>Ogni 10 del mese alle 10:00, ora italiana, il report include tutti i mesi da gennaio all’ultimo mese concluso. Il primo PDF viene inviato appena attivi questo piano. Una sola email per periodo evita duplicazioni.</p>
  <p>Destinatari esclusivi: <strong>giovanni.cappiello@progre.it</strong> e <strong>roberto.profili@progre.it</strong>.</p>
  <p>Fonte Mexal GRE, formato Progre originale. Costi mancanti e mappature da confermare restano evidenziati. Nessuna modifica ai dati contabili.</p>
  {error&&<p role="alert">{error}</p>}{message&&<p role="status">{message}</p>}
  {!plan?<p>Caricamento…</p>:<><p><strong>{plan.enabled?'Piano invii attivo':'In attesa della tua attivazione'}</strong></p><p>Servizio email: {plan.mail?.ready?'pronto':'da verificare'}</p>
   {plan.runs.length===0?<p>Il primo PDF non è ancora stato preparato.</p>:<table><thead><tr><th>Periodo</th><th>Stato</th><th>PDF</th><th>Operazione</th></tr></thead><tbody>{plan.runs.map(r=><tr key={r.id}><td>{r.period.slice(0,7)}</td><td>{({draft:'Preparazione',staged:'Pronto da approvare',queued:'Accodato',uncertain:'Esito da verificare',sent:'Accettato dal servizio email',failed:'Non inviato'})[r.status]}</td><td>{r.verified&&<button disabled={busy} onClick={()=>run('pdf',r.id)}>Scarica PDF</button>}</td><td>{r.status==='staged'&&!plan.enabled&&<button disabled={busy||!plan.mail?.ready} onClick={()=>run('review',r.id)}>Rivedi e attiva il piano</button>}</td></tr>)}</tbody></table>}
   <button disabled={busy} onClick={()=>run('refresh')}>Aggiorna stato</button>
   {review&&<section aria-label="Conferma invio report"><h2>Attiva il piano e invia il primo report</h2><p>Autorizzi gli invii periodici di questo PDF annuale alle due caselle sopra indicate, a partire dal PDF {review.run.filename}. Il primo documento può contenere dati provvisori, indicati nel report.</p><p>{review.run.notes}</p><label><input type="checkbox" checked={checked} onChange={e=>setChecked(e.target.checked)}/>Confermo destinatari, frequenza e primo invio del PDF.</label><p><button disabled={!checked||busy} onClick={()=>run('activate')}>Attiva e invia il primo report</button></p></section>}
  </>}
 </main>;
}
