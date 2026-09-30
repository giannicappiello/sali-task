import {useState} from 'react';
import {action} from './client';
import {Field} from './common';
const stamp=value=>{if(!value)return '—';const [day,time='']=String(value).split('T');return `${day.split('-').reverse().join('/')} ${time.slice(0,8)}`;};
export default function ProductionDates({work,record,token,canWrite,onSaved}){
 const [editing,setEditing]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[input,setInput]=useState(null),[preview,setPreview]=useState(null);
 const run=async fn=>{setBusy(true);setError('');try{await fn();}catch(e){setError(e.message);}finally{setBusy(false);}};
 const change=(key,value)=>{setInput(x=>({...x,[key]:value}));setPreview(null);};
 const started=work.state!=='DaAvviare'&&work.state!=='Annullato'&&work.start;
 return <div className="pc-production-dates">
  {started&&<p><strong>Avviata il {stamp(work.start)}</strong>{work.end&&<> · Terminata il {stamp(work.end)}</>}</p>}
  {canWrite&&work.state==='Terminato'&&!editing&&<button onClick={()=>run(async()=>{
   const {work:current}=await action(token,'dates-read',{id:record.id,targetId:work.id});
   if(!current.canCorrect)throw new Error('La lavorazione non è rettificabile.');
   setInput({id:record.id,targetId:work.id,expectedHash:current.hash,newStartDate:current.before.start.slice(0,10),newEndDate:current.before.end.slice(0,10),newStartTime:null,newEndTime:null,alignBoundaryPresences:false,reason:'',requestId:crypto.randomUUID()});setEditing(true);
  })} disabled={busy}>Modifica date effettive</button>}
  {editing&&input&&<>
   <div className="pc-fields"><Field label="Data inizio"><input type="date" value={input.newStartDate} disabled={busy} onChange={e=>change('newStartDate',e.target.value)}/></Field><Field label="Data fine"><input type="date" value={input.newEndDate} disabled={busy} onChange={e=>change('newEndDate',e.target.value)}/></Field></div>
   <p className="pc-muted">Gli orari registrati vengono conservati.</p>
   <Field label="Motivazione della rettifica"><input value={input.reason} disabled={busy} maxLength={1000} onChange={e=>change('reason',e.target.value)}/></Field>
   <label><input type="checkbox" checked={input.alignBoundaryPresences} disabled={busy} onChange={e=>change('alignBoundaryPresences',e.target.checked)}/> Allinea anche le presenze con inizio o fine coincidenti con la lavorazione</label>
   {preview&&<div role="status"><p>Inizio: {stamp(preview.before.start)} → {stamp(preview.after.start)}<br/>Fine: {stamp(preview.before.end)} → {stamp(preview.after.end)}</p>
    {preview.after.personnel?.filter(p=>{const old=preview.before.personnel.find(x=>x.id===p.id);return old?.start!==p.start||old?.end!==p.end;}).map(p=><p key={p.id}>Presenza {p.id}: {stamp(p.start)} – {stamp(p.end)}</p>)}
   </div>}
   <div className="pc-toolbar"><button disabled={busy||input.reason.trim().length<5} onClick={()=>run(async()=>setPreview(await action(token,'dates-preview',input)))}>Verifica rettifica</button>
   {preview&&<button disabled={busy} onClick={()=>run(async()=>{const result=await action(token,'dates-save',input);if(!result.applied)throw new Error('Rettifica non confermata da MES.');if(result.warning){setError(result.warning);setEditing(false);return;}await onSaved();})}>Conferma rettifica date</button>}
   <button disabled={busy} onClick={()=>{setEditing(false);setPreview(null);}}>Annulla</button></div>
  </>}
  {error&&<p role="alert">{error}</p>}
 </div>;
}
