import {useEffect,useState,useRef} from "react";
import {RefreshCw} from "lucide-react";
import {action,money,quantity,unitMoney} from "./client";
import {fillingUnitLabor} from "./filling-history";
import {formatDisplayDate} from "../../lib/displayLocale";
import CostInfo from "./CostInfo";
const stamp=value=>value?formatDisplayDate(value,{hour:"2-digit",minute:"2-digit"}):"—";
export default function CurrentCostHistory({token,settings}) {
 const [data,setData]=useState({}),[revision,setRevision]=useState(0);
 const currentSettings=useRef(settings);
 useEffect(()=>{currentSettings.current=settings;},[settings]);
 const calendar=JSON.stringify({shifts:settings?.shifts||[]});
 const ready=Boolean(settings);
 const requestKey=calendar+"|"+revision;
 const loading=ready&&data.key!==requestKey;
 useEffect(()=>{
  if(!token||!ready)return;
  let active=true;
  const requestSettings=currentSettings.current;
  const timer=setTimeout(()=>{
   Promise.allSettled([action(token,"station-history",{settings:requestSettings}),action(token,"filling-history",{settings:requestSettings})]).then(results=>{
    if(!active)return;
    setData({key:requestKey,...Object.fromEntries(results.map((result,i)=>[i===0?"station":"filling",result.status==="fulfilled"?result.value.history:{error:result.reason?.message||"Storico non disponibile"}]))});
   });
  },300);
  return()=>{active=false;clearTimeout(timer);};
 },[token,ready,requestKey]);
 return <section className="pc-current-history" aria-label="Medie storiche attuali" aria-busy={loading}>
  <div className="pc-toolbar"><h2>Medie storiche attuali <CostInfo title="Medie storiche attuali"><p>Lavorazioni MES e calendario aziendale HR acquisiti all’apertura. «Aggiorna medie» acquisisce una nuova lettura. Il turno corrente è escluso; i turni completati senza attività sono inclusi.</p><p>I costi usano la tariffa ora/uomo presente nella scheda, anche se non ancora salvata. Le medie sono consultabili anche quando il criterio scelto usa un altro metodo.</p></CostInfo></h2><button type="button" disabled={loading||!ready} onClick={()=>setRevision(n=>n+1)}><RefreshCw size={16}/>{loading?"Acquisizione…":"Aggiorna medie"}</button></div>
  <div className="pc-history-grid">{["station","filling"].map(kind=>{
   const h=loading?null:data[kind],station=kind==="station",title=station?"STATION":"FILLING";
   const count=station?h?.mixingOperatorsCount:h?.packagingOperatorsCount;
   const hourly=settings?.laborHourly;
   const shift=count>0&&hourly!==""&&hourly!=null?count*8*Number(hourly):null;
   const base=h&&!h.error?(station?(h.productivity>0&&shift!==null?shift/h.productivity:null):fillingUnitLabor(h,hourly)):null;
   const metrics=station?[["Lavorazioni concluse",quantity(h?.completedWorks)],["Turni completati",quantity(h?.calendarShifts)],["Costo turno reparto",money(shift)],["Costo medio base",money(base)]]:[["Pezzi buoni chiusi",quantity(h?.completedPieces)],["Turni completati",quantity(h?.calendarShifts)],["Pezzi astucciati",quantity(h?.cartoningPieces)],["Costo per pezzo",unitMoney(base)]];
   return <article className="pc-panel pc-history-card" key={kind}><h3>{title} <CostInfo title={"Calcolo media "+title}><p>{station?"Chiusure medie per turno = lavorazioni concluse ÷ turni completati. Costo medio base = costo turno reparto ÷ chiusure medie; il costo della lavorazione moltiplica questa base per i turni impiegati.":"Pezzi medi per turno = pezzi buoni FILLING chiusi ÷ turni completati. Costo unitario = costo turno reparto ÷ pezzi medi. Astucciatura conteggiata separatamente, senza doppio addebito della manodopera."}</p><p>Organico MES: {quantity(count)} × {money(hourly)} × 8 ore. Costo turno: {money(shift)}.</p><p>{h?.calendar?.historyWarning}</p><p>{h?.cartoningWarning}</p><p>Fonte: {h?.calendar?.source||"MES"}. Revisione: {h?.snapshotId||"—"}.</p></CostInfo></h3>
    <div className="pc-history-primary"><span>{station?"Lavorazioni / turno":"Pezzi / turno"}</span><strong>{loading?"…":h?.error?"Non disponibile":quantity(h?.productivity)}</strong></div>
    {h?.error?<p className="pc-error" role="status">{h.error}</p>:<div className="pc-history-metrics">{metrics.map(([label,value])=><div key={label}><span>{label}</span><strong>{loading?"…":value}</strong></div>)}</div>}
    <footer><span>Periodo: {stamp(h?.periodStart)} – {stamp(h?.periodEnd)}</span><span>Aggiornato: {stamp(h?.generatedAt)}</span></footer>
   </article>;
  })}</div>
 </section>;
}
