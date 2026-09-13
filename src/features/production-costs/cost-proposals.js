import { calculateRecord, validateSettings } from "./cost-engine.js";
import { laborRules, rulesSummary } from "./labor-rules.js";

const fail=message=>{throw new Error(message);};
const keys=(value,allowed)=>{if(!value||typeof value!=="object"||Array.isArray(value)||Object.keys(value).some(k=>!allowed.includes(k)))fail("Proposta contiene campi non supportati.");};
export function applyCostProposal(base,patch) {
 keys(patch,["laborHourly","referenceShiftHours","station","filling","shifts","holidays","machines"]);
 const candidate=structuredClone(base),rules=laborRules(base);delete candidate.aiDefinition;
 for(const key of ["laborHourly","referenceShiftHours"])if(patch[key]!=null)candidate[key]=patch[key];
 for(const [group,allowed] of [["station",["basis","rounding","overtimeMultiplier"]],["filling",["plannedTime","includeCleaning","roundingMinutes"]]]){
  if(patch[group]!=null){keys(patch[group],allowed);for(const key of allowed)if(patch[group][key]!=null)rules[group][key]=patch[group][key];}
 }
 candidate.laborRules=rules;
 if(patch.shifts!=null){
  if(!Array.isArray(patch.shifts)||patch.shifts.length>12)fail("Numero turni non valido.");
  for(const s of patch.shifts)keys(s,["name","start","end","days","breakMinutes"]);
  candidate.shifts=structuredClone(patch.shifts);
 }
 if(patch.holidays!=null){if(!Array.isArray(patch.holidays)||patch.holidays.length>366)fail("Calendario non valido.");candidate.holidays=structuredClone(patch.holidays);}
 if(patch.machines!=null){
  if(!Array.isArray(patch.machines)||patch.machines.length>200)fail("Elenco impianti non valido.");
  const seen=new Set();
  for(const item of patch.machines){
   keys(item,["id","gainPerShift","washMinutes","washCost"]);
   const m=candidate.machines.find(m=>Number(m.id)===Number(item.id));
   if(!m||seen.has(m.id))fail("Impianto non presente o ripetuto: caricare gli impianti da MES.");seen.add(m.id);
   if(item.gainPerShift!=null&&!["TurboEmulsore","Miscelatore"].includes(m.type))fail("Obiettivo di margine consentito solo per STATION.");
   for(const key of ["gainPerShift","washMinutes","washCost"])if(item[key]!=null)m[key]=item[key];
  }
 }
 validateSettings(candidate);
 return candidate;
}
export function proposalChanges(base,next) {
 const changes=[];const add=(name,a,b)=>{if(JSON.stringify(a)!==JSON.stringify(b))changes.push({name,before:a??null,after:b??null});};
 add("Costo ora/uomo",base.laborHourly,next.laborHourly);add("Ore economiche per turno",base.referenceShiftHours??8,next.referenceShiftHours??8);
 const labels={basis:"Base STATION",rounding:"Arrotondamento turni",overtimeMultiplier:"Moltiplicatore straordinario",plannedTime:"Tempo preventivo FILLING",includeCleaning:"Lavaggi nel preventivo FILLING",roundingMinutes:"Arrotondamento FILLING (min)"};
 const a=laborRules(base),b=laborRules(next);
 for(const group of ["station","filling"])for(const key of Object.keys(a[group]))add(labels[key],a[group][key],b[group][key]);
 const calendar=shifts=>(shifts||[]).map(s=>`${s.name}: ${s.start}–${s.end}, ${s.days.map(d=>["Dom","Lun","Mar","Mer","Gio","Ven","Sab"][d]).join(", ")}, pausa ${s.breakMinutes} min`).join("; ");
 add("Turni",calendar(base.shifts),calendar(next.shifts));add("Chiusure",(base.holidays||[]).join(", "),(next.holidays||[]).join(", "));
 for(const m of next.machines||[]){const old=base.machines?.find(x=>x.id===m.id)||{};for(const [k,label] of [["gainPerShift","Margine obiettivo / turno"],["washCost","Costo lavaggio"],["washMinutes","Minuti lavaggio"]])add(`${m.code} · ${label}`,old[k],m[k]);}
 return changes;
}
export function costExamples(settings) {
 // Deterministic fixtures, not real productions or AI-generated arithmetic.
 const station=calculateRecord({quantity:100,unit:"KG",works:[{id:1,machineId:1,phase:"Semilavorato",state:"Terminato",start:"2026-09-07T09:00:00",end:"2026-09-08T11:00:00",personnel:[]}]},{settings});
 const overtime=calculateRecord({quantity:100,unit:"KG",works:[{id:1,machineId:1,phase:"Semilavorato",state:"Terminato",start:"2026-09-07T09:00:00",end:"2026-09-07T17:00:00",personnel:[]}]},{settings});
 const filling=calculateRecord({quantity:1000,unit:"PZ",baseline:{operations:[{type:"Packaging",impiantoId:2,start:"2026-09-07T09:00:00",end:"2026-09-07T12:00:00",operators:2}]},works:[{id:2,machineId:2,phase:"Confezionamento",state:"Terminato",start:"2026-09-07T09:00:00",end:"2026-09-07T12:00:00",goodQuantity:1000,personnel:[{start:"2026-09-07T09:00:00",end:"2026-09-07T12:00:00"},{start:"2026-09-07T09:00:00",end:"2026-09-07T12:00:00"}]}]},{settings});
 return {criteria:rulesSummary(settings),rows:[
  {name:"STATION · lunedì 07/09 09:00 → martedì 08/09 11:00",planned:null,actual:station.actualLabor,detail:`Organico: ${settings.mixingOperatorsCount??"non importato"}; turni ${station.phases[0]?.actualTurns??"n.d."}; straordinario ${station.phases[0]?.actualOvertimeHours??"n.d."} ore.`},
  {name:"FILLING · 2 operatori, lunedì 07/09 09:00–12:00",planned:filling.plannedLabor,actual:filling.actualLabor,detail:"1.000 pezzi buoni; solo manodopera, esclusi materiali e lavaggi."},
  {name:"STATION · lunedì 07/09 09:00–17:00",planned:null,actual:overtime.actualLabor,detail:`Turni ${overtime.phases[0]?.actualTurns??"n.d."}; straordinario ${overtime.phases[0]?.actualOvertimeHours??"n.d."} ore, secondo il calendario configurato.`}
 ]};
}
