import { createSaveOutcome } from "../../save-outcomes.js";
import {useEffect,useRef,useState} from 'react';
import {formatMoney} from './crmConfig';
import {costEntryPayload} from './workspaceCostModel';

const entry = (cost_type,operator='') => ({key:crypto.randomUUID(),cost_type,cost_date:new Date().toLocaleDateString('sv-SE'),hours:'',hourly_rate:30,operator_name:operator,amount:'',description:''});
export default function WorkspaceCostDialog({initial,operator,isAdmin,onSave,onClose}) {
 const target={kind:initial.kind,target:initial.target};
 const [entries,setEntries]=useState(()=>initial.id?[{...initial,key:initial.id}]:[entry('labor',operator),entry('materials')]);
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 const dialog=useRef(null);
 useEffect(()=>{dialog.current?.showModal();},[]);
 const change=(key,field,value)=>setEntries(rows=>rows.map(row=>row.key===key?{...row,[field]:value}:row));
 async function save(event){
    const _saveOutcome = createSaveOutcome();
    try {

  event.preventDefault();if(busy)return;(setError(_saveOutcome.observeFailure('')));setBusy(true);
  try{
   const active=entries.filter(r=>initial.id||(r.cost_type==='labor'?r.hours!=='':r.amount!=='')||r.description.trim());
   if(!active.length)throw Error('Inserisci almeno un costo di lavoro o di materiali.');
   await onSave(active.map(r=>costEntryPayload(r,target)),initial.id);onClose();
  }catch(e){
      _saveOutcome.failure(e);
(setError(_saveOutcome.observeFailure(e.message)));}finally{setBusy(false);}

      _saveOutcome.success();
    } catch (_saveError) { _saveOutcome.failure(_saveError); throw _saveError; }
}
 return <dialog ref={dialog} className="panel crm-cost-editor crm-cost-dialog" aria-labelledby="crm-cost-dialog-title" onCancel={e=>{e.preventDefault();if(!busy)onClose();}}>
  <header><h3 id="crm-cost-dialog-title">{initial.id?'Modifica costo':'Aggiungi costi'}</h3><button type="button" aria-label="Chiudi" disabled={busy} onClick={onClose}>✕</button></header>
  {error&&<p role="alert" className="crm-message error">{error}</p>}
  <form onSubmit={save}>
   <div className="crm-cost-entry-cards">
    {(initial.cost_type==='general'?['general']:['labor','materials']).map(type=><section className={`crm-cost-entry-card crm-cost-entry-card--${type}`} key={type}>
     <h4>{type==='labor'?'1. Lavoro':type==='materials'?'2. Materiali':'Costo già registrato'}</h4>
     {type==='labor'&&<p>Importo calcolato sulle ore lavorate. {isAdmin?'Tariffa oraria modificabile.':'Tariffa oraria modificabile solo da un amministratore.'}</p>}
     {entries.filter(r=>r.cost_type===type).map((r,i)=><fieldset className="crm-cost-entry" key={r.key} disabled={busy}><legend>{type==='labor'?'Lavoro':type==='materials'?'Materiali':'Costo'} {i+1}</legend>
      <label>Data<input type="date" required value={r.cost_date} onChange={e=>change(r.key,'cost_date',e.target.value)}/></label>
      {type==='labor'?<><label>Operatore<input maxLength={200} value={r.operator_name} onChange={e=>change(r.key,'operator_name',e.target.value)}/></label>
       <label>Ore lavorate<input type="number" min="0.01" max="99999999.99" step="0.01" value={r.hours} onChange={e=>change(r.key,'hours',e.target.value)}/></label>
       <label>Costo orario (€)<input type="number" min="0" max="9999999999.99" step="0.01" readOnly={!isAdmin} value={r.hourly_rate} onChange={e=>change(r.key,'hourly_rate',e.target.value)}/></label>
       <p className="crm-cost-entry-total">Costo lavoro: <strong>{formatMoney(Number(r.hours||0)*Number(r.hourly_rate||0))}</strong></p>
      </>:<label>Costo {type==='materials'?'materiali ':''}(€)<input type="number" min="0" max="999999999999.99" step="0.01" value={r.amount} onChange={e=>change(r.key,'amount',e.target.value)}/></label>}
      <label className="crm-cost-entry-description">Descrizione<textarea rows={type==='materials'?5:2} maxLength={1000} value={r.description} onChange={e=>change(r.key,'description',e.target.value)}/></label>
     </fieldset>)}
    </section>)}
   </div>
   <div className="crm-cost-dialog-actions"><button type="submit" className="primary-action crm-primary" disabled={busy}>{busy?'Salvataggio…':initial.id?'Salva costo':'Salva costi'}</button><button type="button" disabled={busy} onClick={onClose}>Annulla</button></div>
  </form>
 </dialog>;
}
