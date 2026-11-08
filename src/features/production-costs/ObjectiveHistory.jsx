import {useState} from 'react';
import {money} from './client';
async function call(token,name,args){
 const response=await fetch('/api/mexal/automation?route=second-brain',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify({action:'call',name,arguments:args})});
 const value=await response.json();if(!response.ok||value.success===false)throw Error(value.error||'Operazione non riuscita.');
 return value.result;
}
export default function ObjectiveHistory({token}){
 const [preview,setPreview]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[review,setReview]=useState(''),[rollback,setRollback]=useState('');
 async function run(propose=false){
  setBusy(true);setError('');
  try{
   const args=rollback.trim()?{rollbackOf:rollback.trim()}:{};
   if(propose){
    const value=await call(token,'PRODUCTION_OBJECTIVE_RECALCULATE',{...args,expectedSnapshot:preview.snapshot,reason:rollback?'Ripristino della versione obiettivo precedente, conservando originali e audit.':'Ricalcolo margine obiettivo per turno da formula storica congelata, senza variazione del margine totale.'});
    const id=value.controlledAction?.id;if(!id)throw Error('ID proposta non restituito: verificare lo stato prima di ripetere.');
    setReview(`/assistente-ai?view=review&kind=controlled&proposalId=${encodeURIComponent(id)}`);
   }else{setReview('');setPreview(await call(token,'PRODUCTION_OBJECTIVE_PREVIEW',args));}
  }catch(e){setError(e.message);}finally{setBusy(false);}
 }
 return <section className="pc-panel"><h2>Obiettivo STATION per turno · storico</h2>
  <p>Obiettivo della singola lavorazione diviso per i turni della formula. Il totale resta fisso. Prezzi, durate e documenti originali vengono conservati.</p>
  <label>Operazione da ripristinare (facoltativa)<input value={rollback} onChange={e=>{setRollback(e.target.value);setPreview(null);setReview('');}} placeholder="ID del ricalcolo da annullare"/></label>
  <button disabled={busy} onClick={()=>run()}>Mostra anteprima impatto</button>
  {error&&<p role="alert">{error}</p>}
  {preview&&<><p>{preview.summary.eligible} documenti ricalcolabili; {preview.summary.excluded} esclusi. Differenza obiettivo totale: {money(preview.summary.objectiveTotalDifference)}. Prezzi e durate modificati: zero.</p>
   <p>{preview.versioning}</p><p>Backup: {preview.backup}</p><p>Rollback: {preview.rollback}</p>
   <details><summary>Differenze per documento ed esclusioni</summary><ul>{preview.items.map(r=><li key={r.id}>{r.orderNumber}: obiettivo per turno {money(r.difference.objectivePerTurnBefore)} → {money(r.difference.objectivePerTurnAfter)}</li>)}{preview.excluded.map(r=><li key={r.id}>{r.orderNumber}: escluso — {r.reason}</li>)}</ul></details>
   {!review&&<button disabled={busy||!preview.items.length} onClick={()=>run(true)}>Prepara proposta da confermare in Workspace</button>}
  </>}
  {review&&<p role="status">Proposta preparata; il ricalcolo richiede conferma personale. <a href={review} target="_blank" rel="noopener noreferrer">Apri riepilogo e conferma</a>. Dopo la conferma aggiorna l’elenco per verificare l’esito.</p>}
 </section>;
}
