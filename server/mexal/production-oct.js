import { buildMexalClient,buildArticleDetailPath } from "./sync-products.js";
import { normalizeOct } from "./sync-oct-orders.js";
import { resolveOctUnitOfMeasure } from "./unit-of-measure.js";
import { octTargets,octCode } from "../../src/features/production-costs/oct-evidence.js";
const text=v=>String(v??"").trim();
const numeric=v=>{const s=text(v);return s!==""&&Number.isFinite(Number(s.includes(",")?s.replaceAll(".","").replace(",","."):s));};
const matrices=["imponibile_riga","importo_netto_riga","valore_netto_riga","prezzo_netto","prezzo_scontato","prezzo","prezzo_unitario","prezzo_listino"];
const mismatch=message=>Object.assign(new Error(message),{notMatching:true});
function hasPrice(document,line,index){
 const rows=document.righe||document.dati?.righe||document.documento?.righe;
 if(Array.isArray(rows))return matrices.some(k=>numeric(rows[index]?.[k]));
 // Position is the sparse matrix position, not the ordinal index in the array.
 return matrices.some(k=>(document[k]||[]).some?.(entry=>Array.isArray(entry)&&Number(entry[0])===Number(line.mexal_posizione)&&numeric(entry.at(-1))));
}
export async function readProductionOct(document,{target,year,mexal,now}){
 const normalized=normalizeOct(document),h=normalized.header;
 const date=text(h.data_ordine).replaceAll("-","").slice(0,8);
 if(normalized.key!==target.reference||Number(date.slice(0,4))!==year||!h.codice_cliente||
  (target.customerCode&&h.codice_cliente!==target.customerCode)||["M","X","I"].includes(octCode(h.mexal_cod_modulo)))
  throw mismatch("Identità OCT, anno o cliente non corrispondenti alla produzione.");
 const candidates=normalized.lines.map((line,index)=>({line,index})).filter(({line})=>
  octCode(line.codice_articolo)===octCode(target.articleCode)&&!line.riga_descrittiva);
 // Repeated article rows can have different prices: never choose the first or
 // silently average them without a preserved source line position.
 if(!candidates.length)throw mismatch("Articolo della produzione assente nell'OCT originale.");
 if(candidates.length!==1)throw new Error("Articolo ripetuto su più righe OCT: collegamento riga necessario.");
 const {line,index}=candidates[0];
 let unit=line.unita_misura_oct;
 if(!unit&&line.tipo_unita_misura_mexal==="1"){
  const article=await mexal.getJson(buildArticleDetailPath(target.articleCode));
  unit=resolveOctUnitOfMeasure({mexalUnitType:"1",article}).unit;
 }
 if(!unit||octCode(unit)!==octCode(target.unit))throw new Error("Unità OCT e produzione non confrontabili.");
 if(!hasPrice(document,line,index))throw new Error("Prezzo/importo netto assente nella riga OCT originale.");
 if(!(line.quantita>0)||!Number.isFinite(line.imponibile_riga))throw new Error("Quantità/importo della riga OCT non validi.");
 return {targetKey:target.key,reference:normalized.key,year,customerCode:h.codice_cliente,
  articleCode:line.codice_articolo,unit,quantity:line.quantita,lineValue:line.imponibile_riga,
  unitPrice:line.prezzo_netto,discount:line.sconto_commerciale,position:line.mexal_posizione,
  date:h.data_ordine,recoveredAt:now,source:"Riga ordine originale Mexal: importo netto effettivo, IVA esclusa"};
}
export async function recoverProductionOct(evidence,{clientForYear=year=>buildMexalClient({year,warehouse:null,timeoutMs:7000}),now=new Date().toISOString()}={}){
 const lines=[],warnings=[],deadline=Date.now()+40000;
 for(const target of octTargets(evidence)){
  const year=Number(String(target.date||"").slice(0,4));
  if(!target.reference||!target.articleCode||year<2000||year>Number(now.slice(0,4))||!Number.isInteger(year)){
   warnings.push("Riferimento o anno OCT non disponibili: recupero non eseguibile.");continue;
  }
  const matches=[];let uncertain=false;const failures=[];
  // MES may date a migrated production in the following year. Search both years
  // only if the original customer-order date is missing; require one match.
  for(const y of target.exactYear?[year]:[year,year-1]){
   if(Date.now()>deadline){uncertain=true;break;}
   try{
    const mexal=clientForYear(y);
    const document=await mexal.getJson("/documenti/ordini-clienti/"+encodeURIComponent(target.reference));
    matches.push(await readProductionOct(document,{target,year:y,mexal,now}));
   }catch(error){
    const status=Number(error.status||error.statusCode||error.upstreamStatus);
    if(![400,404].includes(status)&&!error.notMatching){
     // Validation failures are explicit; they are not an arbitrary match in a
     // different year. Keep diagnostics without exposing upstream credentials.
     uncertain=true;
    }
    if(error.notMatching||(!status&&error.message))failures.push(error.message);
   }
  }
  if(matches.length===1&&!uncertain)lines.push(matches[0]);
  else warnings.push(`${target.reference}: ${matches.length>1?"più anni compatibili":uncertain?"recupero incompleto o dati non corrispondenti":"documento originale non disponibile"}. ${failures.filter(m=>/^(Identità|Articolo|Unità|Prezzo|Quantità)/.test(m)).join(" ")} Verificare anno, cliente, articolo, unità e riga.`);
 }
 // Failed refreshes never erase the last verified original, but its age remains
 // visible. The resolver revalidates it against the current production identity.
 for(const old of evidence.recoveredOctLines||[])if(!lines.some(l=>l.targetKey===old.targetKey))lines.push(old);
 return {lines,warnings,recoveredAt:now};
}
