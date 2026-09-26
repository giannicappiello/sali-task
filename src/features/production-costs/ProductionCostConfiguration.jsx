import { useEffect, useState } from "react";
import { Plus, Save, RefreshCw, Trash2 } from "lucide-react";
import { useAuth } from "../../contexts/AuthContext";
import { defaultSettings, validateSettings } from "./cost-engine";
import { Field, Numeric } from "./common";
import { action, money, date } from "./client";
import { publishCostAssistantDraft } from "./assistant-bridge";
import LaborCriteriaFields from "./LaborCriteriaFields";
import { sameSettings } from "./labor-rules";
import CurrentCostHistory from "./CurrentCostHistory";
import CostInfo from "./CostInfo";


const days=["Lunedì","Martedì","Mercoledì","Giovedì","Venerdì","Sabato","Domenica"];
export default function ProductionCostConfiguration(){
 const {session,hasModuleAccess}=useAuth(),token=session?.access_token;
 const [appliedProposal,setAppliedProposal]=useState(null);
 const [companyCalendar,setCompanyCalendar]=useState(null);
 const [configurationLoaded,setConfigurationLoaded]=useState(false);

 const [settings,setSettings]=useState(defaultSettings),[versions,setVersions]=useState([]),[canWrite,setCanWrite]=useState(false);

 const [applyToHistory,setApplyToHistory]=useState(false);
 const [effective,setEffective]=useState(new Date().toISOString().slice(0,10)),[note,setNote]=useState(""),[busy,setBusy]=useState(false),[error,setError]=useState(""),[message,setMessage]=useState("");
 useEffect(()=>{if(!token)return;let alive=true;action(token,"configuration").then(r=>{if(alive){setCompanyCalendar(r.companyCalendar);setVersions(r.configurations);setCanWrite(r.canWrite);setConfigurationLoaded(true);if(r.configurations[0])setSettings({...defaultSettings(),...r.configurations[0].settings});}}).catch(e=>alive&&setError(e.message));return()=>{alive=false;};},[token]);
 useEffect(()=>{
  publishCostAssistantDraft({token,settings,disabled:!canWrite||!hasModuleAccess?.("assistente_ai")||busy,onApply:p=>{
   setSettings(p.candidate);setAppliedProposal(p);setMessage("Proposta IA confermata e trasferita nel modulo. Verifica la decorrenza e salva la nuova versione per attivarla.");
  }});
  return()=>publishCostAssistantDraft(null);
 },[token,settings,canWrite,hasModuleAccess,busy]);
 const update=(key,value)=>setSettings(s=>({...s,[key]:value}));
 const edit=(key,i,values)=>setSettings(s=>({...s,[key]:s[key].map((x,n)=>n===i?{...x,...values}:x)}));
 const remove=(key,i)=>update(key,settings[key].filter((_,n)=>n!==i));
 async function machines(){setBusy(true);setError("");try{const r=await action(token,"machines");setSettings(s=>({...s,mixingOperatorsCount:r.machines[0]?.mixingOperatorsCount??null,machines:r.machines.map(m=>({...m,washCost:"",...s.machines.find(x=>x.id===m.id)}))}));setMessage("Impianti e numero operatori Miscelazione importati. Nessun piano MES è stato modificato.");}catch(e){setError(e.message);}finally{setBusy(false);}}
 async function save(e){e.preventDefault();setError("");setMessage("");setBusy(true);try{validateSettings(settings);const approved=appliedProposal&&sameSettings(settings,appliedProposal.candidate);await action(token,"save-configuration",{settings,effectiveFrom:effective,note,applyToHistory,...(approved?{proposalId:appliedProposal.id,confirmProposal:true}:{})});const r=await action(token,"configuration");setCompanyCalendar(r.companyCalendar);setVersions(r.configurations);setAppliedProposal(null);
 const historicalDepartments=[settings.laborRules?.station?.basis==="historical_productivity"?"STATION":null,settings.laborRules?.filling?.basis==="historical_pieces"?"FILLING":null].filter(Boolean);
 setMessage(historicalDepartments.length?"Versione salvata. Dalla decorrenza i criteri storici "+historicalDepartments.join(" e ")+" ricalcolano anche le produzioni concluse con le medie MES aggiornate. Dati originali invariati.":applyToHistory?"Nuova versione applicata allo storico ricostruito dalla decorrenza scelta. Operazione tracciata; preventivi originali invariati.":"Nuova versione salvata. Le produzioni prive di versione vengono associate; quelle già associate conservano la configurazione.");
 }catch(e){setError(e.message);}finally{setBusy(false);}}
 const calendarVersion=companyCalendar?.versions.filter(v=>v.effectiveFrom<=effective).sort((a,b)=>a.effectiveFrom.localeCompare(b.effectiveFrom)).at(-1);
 return <main className="pc-page pc-configuration" data-column-controls="off">
 {error&&<p className="pc-error" role="alert">{error}</p>}{message&&<p className="pc-success" role="status">{message}</p>}

 {appliedProposal&&<p className="pc-note">{sameSettings(settings,appliedProposal.candidate)?"Proposta IA confermata, non ancora salvata.":"Hai modificato manualmente i valori della proposta: il prossimo salvataggio sarà una versione manuale."}</p>}
 <CurrentCostHistory token={token} settings={configurationLoaded?settings:null}/>
 <form onSubmit={save}><fieldset disabled={!canWrite||busy}>
 <section className="pc-panel"><h2>Tariffa e versione <CostInfo title="Costo del personale"><p>Un unico costo ora/uomo per tutti gli operatori. I tempi effettivi restano quelli rilevati in MES. Decorrenza e nota si applicano alla nuova versione salvata.</p></CostInfo></h2><div className="pc-fields"><Field label="Costo ora/uomo (€)"><Numeric required value={settings.laborHourly} onChange={v=>update("laborHourly",v)}/></Field><Field label="Decorrenza della nuova versione"><input required type="date" value={effective} onChange={e=>setEffective(e.target.value)}/></Field><Field label="Nota della versione"><input value={note} onChange={e=>setNote(e.target.value)} placeholder="Es. tariffe approvate settembre"/></Field></div></section>
 <LaborCriteriaFields settings={settings} onChange={v=>update("laborRules",v)}/>
 <section className="pc-panel"><h2>Turni e calendario HR <CostInfo title="Calendario aziendale HR"><p>Orari, chiusure, festività ed eccezioni provengono da Rendicontazioni HR. I calcoli usano la versione valida nel giorno della lavorazione, anche per le medie storiche STATION e FILLING. Ogni fascia aziendale HR conta come un turno; gli intervalli fra fasce non sono ore lavorative.</p><p>Qui è mostrata la settimana valida alla decorrenza selezionata. Gli orari personali dei dipendenti e le loro assenze non cambiano il calendario aziendale. Le presenze effettive restano quelle registrate.</p><p>La durata economica resta un criterio di costo separato: le medie storiche utilizzano 8 ore per turno. Se HR non è disponibile il calcolo viene segnalato come non verificabile, senza usare vecchi orari manuali.</p></CostInfo></h2>
 <div className="pc-fields"><Field label="Ore economiche per turno (base costo, normalmente 8)"><Numeric required min="0.01" max="24" value={settings.referenceShiftHours??8} onChange={v=>update("referenceShiftHours",v)}/></Field><Field label="Operatori Miscelazione attivi (da MES)"><input readOnly value={settings.mixingOperatorsCount??"Da importare da MES"}/></Field></div>
 {calendarVersion?<div className="pc-hr-week">{days.map((day,i)=><div key={day}><strong>{day}</strong><span>{calendarVersion.week[String(i+1)].map(slot=>slot.join("–")).join(" · ")||"Chiuso"}</span></div>)}</div>:<p role="status">Calendario HR non disponibile per la decorrenza selezionata.</p>}
 <a href="/settings/hr">Apri calendario in Rendicontazioni HR</a></section>
 <section className="pc-panel"><div className="pc-toolbar"><h2>Lavaggi e obiettivi <CostInfo title="Lavaggi e obiettivo per lavorazione"><div className="pc-config-explanation"><div><strong>Lavaggio</strong><p>Durata standard e costo diretto di un lavaggio. La manodopera viene conteggiata separatamente.</p></div><div><strong>Obiettivo STATION per lavorazione</strong><p>Importo desiderato dopo i costi, conteggiato una sola volta per ogni lavorazione, indipendentemente dai turni. I valori precedenti sono mantenuti come importi per lavorazione.</p></div><div><strong>Consuntivo per turno</strong><p>(Valore OCT − costi consuntivi) ÷ turni effettivi. L’obiettivo non viene sottratto dal guadagno reale: serve come termine di confronto.</p></div></div></CostInfo></h2><button type="button" onClick={machines}><RefreshCw size={17}/>Carica impianti e organico da MES</button></div>
 <div className="pc-table-wrap"><table className="pc-station-config" data-no-column-controls="true"><thead><tr><th>Impianto</th><th>Reparto</th><th>Lavaggio standard (min)</th><th>Costo lavaggio (€)</th><th>Obiettivo per lavorazione (€)</th></tr></thead><tbody>{settings.machines.map((m,i)=><tr key={m.id}><td><strong>{m.code}</strong><small>{m.name}</small></td><td>{m.department}</td><td><Numeric value={m.washMinutes} onChange={v=>edit("machines",i,{washMinutes:v})}/></td><td><Numeric value={m.washCost} onChange={v=>edit("machines",i,{washCost:v})}/></td><td>{["TurboEmulsore","Miscelatore"].includes(m.type)?<Numeric value={m.gainPerWork??m.gainPerShift??""} onChange={v=>edit("machines",i,{gainPerWork:v})}/>:"Non applicabile (filling/altro)"}</td></tr>)}</tbody></table></div>
 {!settings.machines.length&&<p>Caricare gli impianti per configurare lavaggi e obiettivi.</p>}</section>
 <section className="pc-panel"><h2>Prezzi stimati <CostInfo title="Prezzi stimati di vendita"><p>Sezione facoltativa per conservare prezzi di riferimento. I confronti economici utilizzano soltanto gli OCT reali: questi prezzi non sostituiscono un OCT mancante e non modificano ordini o fatture. Una riga completamente vuota non impedisce il salvataggio; se inizi a compilarla devi indicare articolo, unità e prezzo.</p></CostInfo></h2>
 {settings.prices.map((p,i)=><div className="pc-fields" key={i}>{[["articleCode","Codice articolo"],["customerCode","Codice cliente (facoltativo)"],["orderNumber","OdP (facoltativo)"],["unit","Unità (KG / PZ)"]].map(([key,label])=><Field key={key} label={label}><input value={p[key]||""} onChange={e=>edit("prices",i,{[key]:e.target.value})}/></Field>)}<Field label="Prezzo netto unitario (€)"><Numeric value={p.price} onChange={v=>edit("prices",i,{price:v})}/></Field><button type="button" aria-label="Elimina prezzo" onClick={()=>remove("prices",i)}><Trash2 size={16}/></button></div>)}
 <button type="button" onClick={()=>update("prices",[...settings.prices,{articleCode:"",customerCode:"",orderNumber:"",unit:"PZ",price:""}])}><Plus size={17}/>Aggiungi prezzo stimato</button></section>
 <p className="pc-note"><label><input type="checkbox" checked={applyToHistory} onChange={e=>setApplyToHistory(e.target.checked)}/> Applica anche allo storico</label> <CostInfo title="Applicazione allo storico"><p>Applica questa versione alle produzioni storiche prive di preventivo congelato, dalla decorrenza scelta. La scelta resta nel registro; non modifica i dati MES né i preventivi originali.</p></CostInfo></p>
 <div className="pc-save"><button className="pc-primary" type="submit"><Save size={18}/>{busy?"Salvataggio…":"Salva nuova versione"}</button></div></fieldset></form>
 {!canWrite&&<p className="pc-note">Accesso in sola lettura.</p>}
 <details className="pc-panel pc-config-versions"><summary>Versioni conservate · {versions.length}</summary>{versions.map(v=><article className="pc-version" key={v.id}><div><strong>Dal {date(v.effective_from)}</strong><span>{money(v.settings.laborHourly)} / ora/uomo · creata il {date(v.created_at)}</span><small>{v.note}</small>{v.settings.aiDefinition&&<small>Definita con IA · proposta {v.settings.aiDefinition.proposalId} · confermata il {date(v.settings.aiDefinition.confirmedAt)}</small>}</div><button onClick={()=>{setSettings({...defaultSettings(),...v.settings});setAppliedProposal(null);setMessage("Versione caricata nel modulo. Il salvataggio crea una nuova versione, senza alterare lo storico.");}}>Consulta / usa come base</button></article>)}{!versions.length&&<p>Nessuna tariffa inserita: i dati storici saranno consultabili senza costi inventati.</p>}</details>
 </main>;
}
