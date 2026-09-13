// Versioned, declarative accounting rules. Never evaluate model-generated code.
export const defaultLaborRules = () => ({
 station: { basis:"shifts", rounding:0.5, overtimeMultiplier:1 },
 filling: { basis:"presence_hours", plannedTime:"scheduled", includeCleaning:true, roundingMinutes:0 }
});
export function laborRules(settings) {
 const defaults=defaultLaborRules();
 return {station:{...defaults.station,...settings?.laborRules?.station},filling:{...defaults.filling,...settings?.laborRules?.filling}};
}
export function validateLaborRules(settings) {
 const {station:s,filling:f}=laborRules(settings);
 if(!["shifts","scheduled_hours","historical_productivity"].includes(s.basis)||![0,.5,1].includes(s.rounding)||!Number.isFinite(s.overtimeMultiplier)||s.overtimeMultiplier<0||s.overtimeMultiplier>5)throw new Error("Criteri STATION non validi.");
 if(!["presence_hours","historical_pieces"].includes(f.basis)||!["scheduled","elapsed"].includes(f.plannedTime)||typeof f.includeCleaning!=="boolean"||![0,15,30,60].includes(f.roundingMinutes))throw new Error("Criteri FILLING non validi.");
}
export const roundedHours=(hours,minutes=0)=>hours===null?null:minutes?Math.ceil(Math.max(0,hours)*60/minutes-1e-9)*minutes/60:hours;
export const stationPaidHours=(counts,settings)=>{
 if(!counts)return null;
 const r=laborRules(settings).station;
 if(r.basis==="historical_productivity")return null; // Requires verified department evidence.
 return (r.basis==="shifts"?counts.turns*Number(settings.referenceShiftHours??8):counts.scheduledHours)+counts.overtimeHours*r.overtimeMultiplier;
};
export function rulesSummary(settings={}) {
 const {station:s,filling:f}=laborRules(settings);
 return [
  s.basis==="historical_productivity"?"STATION su media storica: (organico Miscelazione MES attivo × tariffa × 8 / chiusure medie per turno di reparto) × turni della lavorazione da calendario MES, minimo 0,5 solo entro calendario e mezzo turno superiore. Straordinario confermato = costo medio turno / 8 × ore × moltiplicatore. Dopo le 17:00 solo secondo turno configurato o straordinario esplicito. Ricalcola anche le produzioni concluse.":`STATION: organico Miscelazione attivo × tariffa unica × (${s.basis==="shifts"?`turni × ${settings.referenceShiftHours??8} ore economiche`:"ore entro calendario"} + straordinario × ${s.overtimeMultiplier}). Dopo le 17:00 solo turni configurati o straordinario esplicito. Turni: ${s.rounding===0?"frazione esatta":s.rounding===.5?"mezzo turno superiore":"turno intero superiore"}.`,
  f.basis==="historical_pieces"?"FILLING su media storica: costo turno reparto = organico Confezionamento MES attivo × tariffa unica × 8. Produttività = pezzi buoni FILLING conclusi / turni di reparto completati, inclusi quelli senza attività, escluso il turno corrente. Costo al pezzo = costo turno / produttività. Preventivo sui pezzi previsti, consuntivo sui pezzi buoni chiusi. Astucciatura conteggiata separatamente, esclusa dalla produttività FILLING e senza addebito autonomo: organico già nel costo reparto. Ricalcola anche le produzioni concluse.":`FILLING: preventivo = operatori previsti × ore ${f.plannedTime==="scheduled"?"entro calendario":"di durata planning"}; ${f.includeCleaning?"include":"esclude"} manodopera lavaggi pianificati. Consuntivo = somma ore presenze. Arrotondamento per intervallo: ${f.roundingMinutes?`${f.roundingMinutes} minuti superiori`:"nessuno"}. Entrambi × tariffa unica.`,
  "Obiettivo STATION: margine dopo i costi, per turno. Non è un costo né un ricavo."
 ];
}
export const sameSettings=(a,b)=>stable(a)===stable(b);
function stable(v){return JSON.stringify(v,(_,x)=>x&&typeof x==="object"&&!Array.isArray(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x);}
