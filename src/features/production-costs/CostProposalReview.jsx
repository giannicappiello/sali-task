import { useEffect, useState } from "react";

import { action, money, date } from "./client";
import { sameSettings } from "./labor-rules";
import { Field } from "./common";

const printable=v=>typeof v==="object"?JSON.stringify(v):typeof v==="boolean"?(v?"Sì":"No"):String(v??"Non impostato");
export default function CostProposalReview({token,settings,disabled,onApply}) {
 const [proposal,setProposal]=useState(null),[history,setHistory]=useState([]),[error,setError]=useState(""),[confirmed,setConfirmed]=useState(false);
 function choose(row){setProposal(row);setConfirmed(false);const url=new URL(window.location.href);url.searchParams.set("costProposal",row.id);window.history.replaceState(window.history.state,"",url);}
 function resetConversation(){setProposal(null);setConfirmed(false);const url=new URL(window.location.href);url.searchParams.delete("costProposal");window.history.replaceState(window.history.state,"",url);}
 useEffect(()=>{
  if(!token||disabled)return;let active=true;
  const refresh=async(id)=>{try{
   const r=await action(token,"ai-history");if(!active)return;setHistory(r.proposals);
   const selected=id||r.proposals[0]?.id;
   if(selected){const result=await action(token,"ai-proposal",{id:selected});if(active){setProposal(result.proposal);setConfirmed(false);}}
  }catch(e){if(active)setError(e.message);}};
  const onResponse=event=>{if(event.detail?.costProposalId)refresh(event.detail.costProposalId);};
  refresh(new URL(window.location.href).searchParams.get("costProposal"));
  window.addEventListener("workspace:assistant-response",onResponse);
  return()=>{active=false;window.removeEventListener("workspace:assistant-response",onResponse);};
 },[token,disabled]);
 const stale=proposal?.base_settings&&!sameSettings({...settings,aiDefinition:undefined},{...proposal.base_settings,aiDefinition:undefined});
 const transferred=proposal?.candidate&&sameSettings({...settings,aiDefinition:undefined},proposal.candidate);
 return <section className="pc-panel pc-ai" aria-label="Proposte criteri di produzione">
  <h3>Proposte e verifiche costi di produzione</h3>
  <p>Chiedi le modifiche nella conversazione dell’assistente. Qui ritrovi lo storico, il confronto dei valori e gli esempi prima della conferma.</p>
  {disabled?<p className="pc-note">Per usare l’IA servono la scrittura su questa schermata e l’abilitazione Assistente AI. La configurazione manuale resta disponibile secondo i tuoi permessi.</p>:<>
   {!!history.length&&<Field label="Conversazioni / proposte conservate"><select value={proposal?.id||""} disabled={false} onChange={async e=>{if(!e.target.value){resetConversation();return;}setError("");try{choose((await action(token,"ai-proposal",{id:e.target.value})).proposal);}catch(err){setError(err.message);}}}><option value="">Seleziona una proposta</option>{history.map(p=><option key={p.id} value={p.id}>{date(p.created_at)} · {p.prompt.slice(0,85)} · {p.status}</option>)}</select></Field>}
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
      <button type="button" className="pc-primary" disabled={(stale&&!transferred)||!confirmed} onClick={()=>onApply(proposal)}>Trasferisci proposta confermata nel modulo</button>
      <p>Per renderla operativa devi poi scegliere la decorrenza e premere «Salva nuova versione».</p>
     </>}
    </>}
   </div>}
  </>}
  {error&&<p className="pc-error" role="alert">{error}</p>}
 </section>;
}
