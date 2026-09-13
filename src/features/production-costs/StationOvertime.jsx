import { useState } from "react";
import { Field } from "./common";
import { action } from "./client";
import { validateOvertime } from "./overtime";

export default function StationOvertime({record,token,onSaved}) {
 const [entries,setEntries]=useState(()=>record.adjustment?.overtime||[]);
 const [reason,setReason]=useState(""),[busy,setBusy]=useState(false),[error,setError]=useState("");
 const works=record.phases.filter(w=>w.id>0&&w.phase==="Semilavorato"&&!["Annullato","DaAvviare"].includes(w.state));
 if(!works.length)return null;
 const edit=(i,key,value)=>setEntries(rows=>rows.map((r,n)=>n===i?{...r,[key]:value}:r));
 async function save(){
  setBusy(true);setError("");
  try{
   const now=new Intl.DateTimeFormat("sv-SE",{timeZone:"Europe/Rome",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit"}).format(new Date()).replace(" ","T");
   const overtime=validateOvertime(entries,works,now);
   await action(token,"overtime",{id:record.id,overtime,reason});await onSaved();
  }
  catch(e){setError(e.message);}finally{setBusy(false);}
 }
 return <section className="pc-panel"><h3>Straordinario STATION confermato</h3>
 <p>Le ore dopo le 17:00 non generano costi extra automaticamente. Registra qui soltanto lo straordinario effettivo: il tempo già coperto da un turno viene escluso per evitare doppie valorizzazioni. Il salvataggio sostituisce questo elenco, conserva la rettifica e non cambia gli orari MES.</p>
 <fieldset disabled={busy}>{entries.map((entry,i)=><div className="pc-fields" key={i}>
 <Field label="Lavorazione STATION"><select value={entry.productionId} onChange={e=>edit(i,"productionId",Number(e.target.value))}>{works.map(w=><option key={w.id} value={w.id}>{w.machine?.code||w.machineId} · lavorazione {w.id}</option>)}</select></Field>
 <Field label="Inizio straordinario"><input type="datetime-local" value={entry.start} onChange={e=>edit(i,"start",e.target.value)}/></Field>
 <Field label="Fine straordinario"><input type="datetime-local" value={entry.end} onChange={e=>edit(i,"end",e.target.value)}/></Field>
 <button type="button" onClick={()=>setEntries(rows=>rows.filter((_,n)=>n!==i))}>Rimuovi intervallo</button>
 </div>)}
 <button type="button" onClick={()=>setEntries(rows=>[...rows,{productionId:works[0].id,start:"",end:""}])}>Aggiungi straordinario</button>
 <Field label="Fonte / autorizzazione straordinario"><input value={reason} onChange={e=>setReason(e.target.value)} placeholder="Es. registro straordinari confermato dal responsabile"/></Field>
 <button type="button" onClick={save} disabled={!reason.trim()}>Registra straordinario</button></fieldset>
 {error&&<p role="alert" className="pc-error">{error}</p>}
 </section>;
}
