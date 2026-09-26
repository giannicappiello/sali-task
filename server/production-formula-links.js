const phaseType={Semilavorato:"Production",Confezionamento:"Packaging",Astucciatura:"Cartoning"};
const positive=v=>v!=null&&v!==""&&Number.isFinite(Number(v))&&Number(v)>0?Number(v):null;
const complete=o=>o&&o.durationMinutes!=null&&Number.isFinite(Number(o.durationMinutes))&&Number(o.durationMinutes)>=0&&positive(o.lotCount);
const key=o=>`${o.impiantoId}:${o.type}`;

// Recover only missing links. Frozen preventive rows remain authoritative.
// Machine parameters are accepted only when imported evidence agrees exactly;
// never infer forecast duration or quantity from actual work/SL values.
export function recoverFormulaLinks(records) {
 const machines=new Map();
 for(const e of records)for(const o of e.plannedTiming?.operations||[]){
  if(!o.impiantoId)continue;
  const value={maximumCapacity:o.maximumCapacity,speed:o.speed,minimumOperators:o.minimumOperators};
  if(Object.values(value).some(v=>v==null||!Number.isFinite(Number(v))))continue;
  const values=machines.get(o.impiantoId)||new Map();
  values.set(JSON.stringify(value),{...value,sourceOrderId:e.id});machines.set(o.impiantoId,values);
 }
 return records.map(e=>{
  const original=e.baseline?.plannedTiming||e.plannedTiming;
  if(!original)return e;
  const rows=(original.operations||[]).map(o=>({...o})),recovered=[],unresolved=[];
  const active=(e.works||[]).filter(w=>w.state!=="Annullato"&&phaseType[w.phase]);
  const targets=[...new Map(active.map(w=>[`${w.machineId}:${phaseType[w.phase]}`,{impiantoId:w.machineId,type:phaseType[w.phase]}])).values()];
  for(const target of targets){
   const index=rows.findIndex(o=>key(o)===key(target));
   if(complete(rows[index]))continue;
   const current=(e.plannedTiming?.operations||[]).find(o=>key(o)===key(target));
   if(complete(current)&&e.plannedTiming.formulaVersionId===original.formulaVersionId){
    if(index<0)rows.push({...current});else rows[index]={...current};
    recovered.push({...target,source:"Parametri della stessa revisione formula importati da MES"});continue;
   }
   const own=rows[index]||current;
   const known=machines.get(target.impiantoId);
   const machine=own&&[own.maximumCapacity,own.speed,own.minimumOperators].every(v=>v!=null)?own:known?.size===1?[...known.values()][0]:null;
   const fail=reason=>unresolved.push({...target,reason});
   if(!original.formulaVersionId){fail("Revisione formula non identificata");continue;}
   if(!machine){fail("Parametri impianto assenti o discordanti");continue;}
   // Old unexecuted planning on another machine is not a second actual split.
   const single=targets.filter(t=>t.type===target.type).length===1;
   const frozen=(e.baseline?.operations||[]).filter(o=>key(o)===key(target));
   const frozenQty=frozen.reduce((s,o)=>s+(positive(o.quantity)||0),0);
   const qty=single?(target.type==="Production"?(positive(e.baseline?.bulkQuantity)||positive(e.historicalBaseline?.bulkQuantity)||(["KG","KGS"].includes(e.unit?.toUpperCase())?positive(e.baseline?.quantity)||positive(e.quantity):null)):(positive(e.baseline?.quantity)||positive(e.quantity))):positive(frozenQty);
   if(!qty){fail("Quantità preventiva o ripartizione fra impianti non verificabile");continue;}
   const plan=(e.operations||[]).filter(o=>key(o)===key(target));
   const operators=positive(own?.operators)||Math.max(...[...frozen,...plan].map(o=>positive(o.operators)||0),positive(machine.minimumOperators)||0);
   let durationMinutes=null,lotCount=1;
   if(target.type==="Production"){
    const hours=positive(original.productionHours),phases=positive(original.phaseMinutes);
    const lengths=(original.calendar?.shifts||[]).map(s=>{const m=t=>Number(t.slice(0,2))*60+Number(t.slice(3));return (m(s.end)-m(s.start)+1440)%1440;});
    const unique=[...new Set(lengths.filter(n=>n>0))];
    if(hours&&unique.length===1)durationMinutes=Math.floor(hours/8)*unique[0]+(hours%8)*60;
    else if(!hours&&phases)durationMinutes=phases;
    if(!(machine.maximumCapacity>0)){fail("Capacità del lotto non verificabile");continue;}
    lotCount=Math.ceil(qty/machine.maximumCapacity);
   }else{
    const minutes=machine.speed>0?Math.ceil(qty/machine.speed*60):positive(original.packagingMinutes);
    if(minutes&&operators>0&&machine.minimumOperators>0)durationMinutes=Math.ceil(minutes*machine.minimumOperators/operators);
   }
   if(!positive(durationMinutes)){fail("Tempo formula o velocità impianto non disponibili");continue;}
   const row={...target,quantity:qty,operators,durationMinutes,lotCount,maximumCapacity:machine.maximumCapacity,speed:machine.speed,minimumOperators:machine.minimumOperators};
   if(index<0)rows.push(row);else rows[index]=row;
   recovered.push({...target,source:"Durata formula conservata, quantità preventiva e parametri impianto importati",machineEvidenceOrderId:machine.sourceOrderId??e.id});
  }
  if(!recovered.length&&!unresolved.length){const clean={...e};delete clean.plannedTimingRecovery;return clean;}
  return {...e,plannedTimingRecovery:{schema:1,formulaVersionId:original.formulaVersionId,recovered,unresolved,timing:{...original,operations:rows,source:original.source+" Collegamenti mancanti ricostruiti senza utilizzare tempi o quantità consuntivi. Preventivo originale conservato."}}};
 });
}
