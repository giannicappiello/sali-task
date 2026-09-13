import { useEffect, useRef, useState } from "react";
import { Sparkles, Send } from "lucide-react";
import { action, money, date } from "./client";
import { sameSettings } from "./labor-rules";
import { Field } from "./common";

const printable=v=>typeof v==="object"?JSON.stringify(v):typeof v==="boolean"?(v?"Sì":"No"):String(v??"Non impostato");
export default function CostAIAssistant({token,settings,disabled,onApply}) {
 const [prompt,setPrompt]=useState(""),[proposal,setProposal]=useState(null),[history,setHistory]=useState([]),[busy,setBusy]=useState(false),[error,setError]=useState(""),[confirmed,setConfirmed]=useState(false);
 const mounted=useRef(true);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 function choose(row){setProposal(row);setConfirmed(false);const url=new URL(window.location.href);url.searchParams.set("costProposal",row.id);window.history.replaceState(null,"",url);}
 function resetConversation(){setProposal(null);setConfirmed(false);const url=new URL(window.location.href);url.searchParams.delete("costProposal");window.history.replaceState(null,"",url);}
 useEffect(()=>{
  if(!token||disabled)return;let active=true;
  action(token,"ai-history").then(r=>active&&setHistory(r.proposals)).catch(e=>active&&setError(e.message));
  const id=new URL(window.location.href).searchParams.get("costProposal");
  if(id)action(token,"ai-proposal",{id}).then(r=>{if(active){setProposal(r.proposal);setConfirmed(false);}}).catch(e=>active&&setError(e.message));
  return()=>{active=false;};
 },[token,disabled]);
 async function send(){
  if(!prompt.trim())return;setBusy(true);setError("");setConfirmed(false);
  const id=crypto.randomUUID();
  // The address survives a refresh even if the browser loses the response.
  const url=new URL(window.location.href);url.searchParams.set("costProposal",id);window.history.replaceState(null,"",url);
  try{const r=await action(token,"ai-propose",{requestId:id,parentId:proposal?.id||null,prompt,settings});if(!mounted.current)return;choose(r.proposal);setPrompt("");if(r.warning)setError(r.warning);const h=await action(token,"ai-history");if(mounted.current)setHistory(h.proposals);}
  catch(e){if(mounted.current)setError(e.message);}finally{if(mounted.current)setBusy(false);}
 }
 const stale=proposal?.base_settings&&!sameSettings({...settings,aiDefinition:undefined},{...proposal.base_settings,aiDefinition:undefined});
 const transferred=proposal?.candidate&&sameSettings({...settings,aiDefinition:undefined},proposal.candidate);
 return <section className="pc-panel pc-ai" aria-label="Assistente IA criteri di produzione">
  <h2><Sparkles size={22}/> Definisci criteri e obiettivi con l’IA</h2>
  <p>Descrivi le regole STATION, quelle FILLING e il margine desiderato per ogni STATION. L’IA conversa con te, propone modifiche e chiede chiarimenti. Nessun salvataggio automatico.</p>
  {disabled?<p className="pc-note">Per usare l’IA servono la scrittura su questa schermata e l’abilitazione Assistente AI. La configurazione manuale resta disponibile secondo i tuoi permessi.</p>:<>
   {!!history.length&&<Field label="Conversazioni / proposte conservate"><select value={proposal?.id||""} disabled={busy} onChange={async e=>{if(!e.target.value){resetConversation();return;}setError("");try{choose((await action(token,"ai-proposal",{id:e.target.value})).proposal);}catch(err){setError(err.message);}}}><option value="">Nuova conversazione</option>{history.map(p=><option key={p.id} value={p.id}>{date(p.created_at)} · {p.prompt.slice(0,85)} · {p.status}</option>)}</select></Field>}
   {proposal&&<div className="pc-ai-answer" aria-live="polite"><p><strong>Tu:</strong> {proposal.prompt}</p>
    {proposal.status==="pending"?<p>Richiesta in elaborazione. Riapri la proposta dallo storico per verificarne l’esito.</p>:proposal.status==="error"?<p role="alert">{proposal.error}</p>:<>
     <p className="pc-ai-text"><strong>IA:</strong> {proposal.result?.answer}</p>
     {proposal.result?.questions?.map((q,i)=><p key={i}><strong>Da chiarire:</strong> {q}</p>)}
     {proposal.result?.validationError&&<p className="pc-error">{proposal.result.validationError} Nessuna proposta applicabile: rispondi con i dati mancanti.</p>}
     {proposal.candidate&&<>
      <h3>Modifiche proposte</h3><div className="pc-table-wrap"><table><thead><tr><th>Criterio</th><th>Prima</th><th>Proposta</th></tr></thead><tbody>{proposal.result.changes.map((c,i)=><tr key={i}><td>{c.name}</td><td>{printable(c.before)}</td><td>{printable(c.after)}</td></tr>)}</tbody></table></div>
      {!proposal.result.changes.length&&<p>I criteri coincidono con quelli nel modulo.</p>}
      {proposal.result.examples?.criteria.map(c=><p key={c}>{c}</p>)}
      <h3>Esempi calcolati dal motore</h3><p>Scenari fittizi sul calendario configurato, non produzioni reali. Dati mancanti restano non disponibili.</p>
      <div className="pc-table-wrap"><table><thead><tr><th>Esempio</th><th>Manodopera preventiva</th><th>Manodopera consuntiva</th></tr></thead><tbody>{proposal.result.examples?.rows.map(r=><tr key={r.name}><td>{r.name}<small>{r.detail}</small></td><td>{money(r.planned)}</td><td>{money(r.actual)}</td></tr>)}</tbody></table></div>
      {stale&&!transferred?<p className="pc-note">Il modulo è cambiato rispetto alla base della proposta. Chiedi all’IA di aggiornarla prima di confermare.</p>:<label className="pc-ai-confirm"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/> Ho verificato criteri, valori ed esempi; confermo questa proposta.</label>}
      <button type="button" className="pc-primary" disabled={busy||(stale&&!transferred)||!confirmed} onClick={()=>onApply(proposal)}>Trasferisci proposta confermata nel modulo</button>
      <p>Per renderla operativa devi poi scegliere la decorrenza e premere «Salva nuova versione».</p>
     </>}
    </>}
   </div>}
   <Field label={proposal?"Rispondi all’IA o chiedi una modifica":"Descrivi i criteri che vuoi definire"}><textarea value={prompt} maxLength={6000} disabled={busy} onChange={e=>setPrompt(e.target.value)} placeholder="Es. STATION: organico Miscelazione, mezzo turno superiore e straordinario al 25%. FILLING: presenze esatte. Per ST1 voglio 500 € di margine per turno."/></Field>
   <div className="pc-toolbar"><button type="button" className="pc-primary" disabled={busy||!prompt.trim()} onClick={send}><Send size={17}/>{busy?"L’IA sta preparando la risposta…":"Invia all’IA"}</button>{proposal&&<button type="button" disabled={busy} onClick={resetConversation}>Nuova conversazione</button>}</div>
  </>}
  {error&&<p className="pc-error" role="alert">{error}</p>}
 </section>;
}
