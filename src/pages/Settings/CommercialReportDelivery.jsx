import {useEffect,useState} from 'react';
import {Link} from 'react-router-dom';
import {supabase} from '../../lib/supabaseClient';

async function request(body) {
  const {data:{session}}=await supabase.auth.getSession();
  if(!session)throw new Error('Accedi nuovamente a Workspace.');
  const response=await fetch('/api/mexal/automation?route=commercial-reports',{
    method:body?'POST':'GET',headers:{Authorization:'Bearer '+session.access_token,'Content-Type':'application/json'},
    ...(body?{body:JSON.stringify(body)}:{}),
  });
  const payload=await response.json();if(!response.ok)throw new Error(payload.error||'Configurazione non disponibile.');return payload;
}
export default function CommercialReportDelivery() {
  const [plan,setPlan]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const [triggerId,setTriggerId]=useState(''),[token,setToken]=useState(''),[confirmed,setConfirmed]=useState(false),[outcome,setOutcome]=useState('');
  async function load() {try{const p=await request();setPlan(p);setTriggerId(p.triggerId||'');setError('');}catch(e){setError(e.message);}}
  useEffect(()=>{let cancelled=false;request().then(p=>{if(!cancelled){setPlan(p);setTriggerId(p.triggerId||'');}}).catch(e=>{if(!cancelled)setError(e.message);});return()=>{cancelled=true;};},[]);
  async function save(enabled) {
    setBusy(true);setError('');setOutcome('');
    try {await request({action:'configure',enabled,policyHash:plan.policyHash,confirmPlan:enabled?confirmed:true,triggerId,accessToken:token});setToken('');setConfirmed(false);await load();setOutcome(enabled?'Invio mensile attivato. Nessuna email è stata inviata adesso.':'Invio mensile sospeso.');}
    catch(e){setError(e.message);}finally{setBusy(false);}
  }
  return <main className="page" style={{maxWidth:1080,margin:'0 auto',padding:24}}>
    <Link to="/settings/ai">← Configurazione AI</Link>
    <h1>Invio report commerciali</h1>
    <p>I report del mese precedente vengono preparati in anticipo con il template Progre e i grafici approvati. L’invio è il 10 del mese alle 10:00, ora italiana.</p>
    {error&&<p role="alert">{error}</p>}{outcome&&<p role="status">{outcome}</p>}
    {!plan?<p>Caricamento configurazione…</p>:<>
      <p><strong>{plan.enabled?'Piano attivo':'Piano non attivo'}</strong></p>
      {plan.contactsError&&<p role="alert">{plan.contactsError}</p>}
      <section className="panel" style={{padding:20,marginBottom:20}}>
        <h2>Destinatari e contenuto</h2>
        <p>Oggetto: <strong>Report Commerciale mese di [mese anno]</strong>. Ogni agente riceve soltanto il proprio PDF.</p>
        <table><thead><tr><th>Agente</th><th>Rete</th><th>Fonte</th><th>Email individuale</th></tr></thead><tbody>{plan.recipients.individual.map(a=><tr key={a.code}><td>{a.name}</td><td>{a.network==='ph'?'Farmacie':'Professional'}</td><td>{a.source==='ordiniph'?'Ordini PH':'Fatture'}</td><td>{a.to}</td></tr>)}</tbody></table>
        <p>Un’unica email con i due consolidati PR/PH e tutti i PDF individuali a: <strong>{plan.recipients.aggregate.join(', ')}</strong>.</p>
        <p>Ogni responsabile riceve nella stessa email il consolidato della propria squadra, con classifica agenti, e i report individuali dei soli agenti collegati. Se è anche agente, il suo report viene incluso nella stessa email.</p>
        <ul>{(plan.manifest?.managers||[]).map(m=><li key={m.id}>{m.name}: {m.to} — {m.agentCodes.map(c=>plan.agents.find(a=>a.code===c)?.name||c).join(', ')}</li>)}</ul>
        <p>Bertozzi, Bosco, Gudenzi, Esperto e MyPharma sono esclusi.</p>
      </section>
      <section className="panel" style={{padding:20,marginBottom:20}}>
        <h2>Collegamento</h2>
        <p>{plan.mail.ready?'Servizio email ordini pronto. Mittente: '+plan.mail.from:plan.mail.message}</p>
        <p><a href="https://chatgpt.com/agents/studio/edit/agt_6aef5e2ab1548191a65ca9d013eba409" target="_blank" rel="noreferrer">Apri l’agente ChatGPT</a></p>
        <label style={{display:'block',marginBottom:12}}>Codice del canale di collegamento ChatGPT<input aria-label="Codice del canale ChatGPT" value={triggerId} onChange={e=>setTriggerId(e.target.value)} placeholder="agtch_…" autoComplete="off" style={{display:'block',width:'100%'}}/></label>
        <label style={{display:'block',marginBottom:12}}>Autorizzazione riservata dell’agente<input aria-label="Autorizzazione riservata dell’agente" type="password" autoComplete="new-password" value={token} onChange={e=>setToken(e.target.value)} placeholder={plan.hasToken?'Già conservata in modo protetto; lascia vuoto per mantenerla':'Inserisci l’autorizzazione ChatGPT'} style={{display:'block',width:'100%'}}/></label>
        <p>L’autorizzazione viene cifrata sul server e non viene mostrata all’agente o agli altri utenti. Non serve una chiave della piattaforma OpenAI.</p>
        <label><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/> Approvo questo piano ricorrente: i PDF degli agenti elencati possono essere inviati ai destinatari indicati usando il servizio email ordini.</label>
        <div style={{display:'flex',gap:12,marginTop:16}}><button disabled={busy||!confirmed||!plan.mail.ready||!plan.contactsReady} onClick={()=>save(true)}>Collega e attiva invio mensile</button><button disabled={busy||!plan.enabled} onClick={()=>save(false)}>Sospendi invii</button><button disabled={busy} onClick={load}>Aggiorna verifica</button></div>
      </section>
      <section><h2>Ultimi lotti</h2>{!plan.batches.length?<p>Nessun lotto generato o inviato.</p>:<ul>{plan.batches.map(b=><li key={b.id}>{b.period}: {b.status}{b.conversation_url&&<> — <a href={b.conversation_url}>Apri esecuzione ChatGPT</a></>}</li>)}</ul>}</section>
    </>}
  </main>;
}
