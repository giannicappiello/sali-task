// Versioned, declarative accounting rules. Never evaluate model-generated code.
export const defaultLaborRules = () => ({
 station: { basis:"shifts", rounding:0.5, overtimeMultiplier:1 },
 filling: { plannedTime:"scheduled", includeCleaning:true, roundingMinutes:0 }
});
export function laborRules(settings) {
 const defaults=defaultLaborRules();
 return {station:{...defaults.station,...settings?.laborRules?.station},filling:{...defaults.filling,...settings?.laborRules?.filling}};
}
export function validateLaborRules(settings) {
 const {station:s,filling:f}=laborRules(settings);
 if(!["shifts","scheduled_hours"].includes(s.basis)||![0,.5,1].includes(s.rounding)||!Number.isFinite(s.overtimeMultiplier)||s.overtimeMultiplier<0||s.overtimeMultiplier>5)throw new Error("Criteri STATION non validi.");
 if(!["scheduled","elapsed"].includes(f.plannedTime)||typeof f.includeCleaning!=="boolean"||![0,15,30,60].includes(f.roundingMinutes))throw new Error("Criteri FILLING non validi.");
}
export const roundedHours=(hours,minutes=0)=>hours===null?null:minutes?Math.ceil(Math.max(0,hours)*60/minutes-1e-9)*minutes/60:hours;
export const stationPaidHours=(counts,settings)=>{
 if(!counts)return null;
 const r=laborRules(settings).station;
 return (r.basis==="shifts"?counts.turns*Number(settings.referenceShiftHours??8):counts.scheduledHours)+counts.overtimeHours*r.overtimeMultiplier;
};
export function rulesSummary(settings={}) {
 const {station:s,filling:f}=laborRules(settings);
 return [
  `STATION: organico Miscelazione attivo × tariffa unica × (${s.basis==="shifts"?`turni × ${settings.referenceShiftHours??8} ore economiche`:"ore entro calendario"} + straordinario × ${s.overtimeMultiplier}). Turni: ${s.rounding===0?"frazione esatta":s.rounding===.5?"mezzo turno superiore":"turno intero superiore"}.`,
  `FILLING: preventivo = operatori previsti × ore ${f.plannedTime==="scheduled"?"entro calendario":"di durata planning"}; ${f.includeCleaning?"include":"esclude"} manodopera lavaggi pianificati. Consuntivo = somma ore presenze. Arrotondamento per intervallo: ${f.roundingMinutes?`${f.roundingMinutes} minuti superiori`:"nessuno"}. Entrambi × tariffa unica.`,
  "Obiettivo STATION: margine dopo i costi, per turno. Non è un costo né un ricavo."
 ];
}
export const sameSettings=(a,b)=>stable(a)===stable(b);
function stable(v){return JSON.stringify(v,(_,x)=>x&&typeof x==="object"&&!Array.isArray(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x);}
