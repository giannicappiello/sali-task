import {useState} from 'react';
import {Modal} from './common';
import CostInfo from './CostInfo';
import {signedMoney} from './client';
import PrivateReportTable from './PrivateReportTable';
import {privateComparisons} from './private-report';
function Info({title,children}){return <span onClick={e=>e.stopPropagation()} onKeyDown={e=>e.stopPropagation()}><CostInfo title={title}><p>{children}</p></CostInfo></span>;}
const names={invoiceValue:'FT',workedOct:'OC',comparisonTotal:'consuntivi'};
export default function PrivateCostSummaryCards({rows,saliRows=[]}){
 const [selected,setSelected]=useState(null),comparisons=privateComparisons(rows);
 const missingOc=rows.filter(r=>r.workedOct==null),missingInvoice=rows.filter(r=>r.invoiceValue==null);
 return <><div className="pc-private-comparison-overview">
 <article className="pc-panel"><h3>Consuntivi Lavorazioni<Info title="Confronti delle lavorazioni">Ogni colonna usa solo le lavorazioni con entrambi gli importi disponibili. Il saldo è il primo valore meno il secondo. Sono mostrate in rosso soltanto le differenze negative. I valori OC, fattura e consuntivo sono quelli attribuiti alla lavorazione; i dati parziali restano segnalati nei dettagli.</Info></h3><div className="pc-private-comparison-metrics">{comparisons.map(c=><button className="pc-private-comparison-metric" key={c.key} onClick={()=>setSelected({title:c.label,items:c.items})}><span>{c.label}</span><strong className={c.difference<0?"pc-balance-negative":""}>{c.difference<0?signedMoney(c.difference):'—'}</strong><small>{c.items.length} confrontabili · {c.excluded} escluse</small><small>Mancanti: {c.missingLeft} {names[c.left]} · {c.missingRight} {names[c.right]}</small></button>)}</div></article>
 <article className="pc-panel"><h3>Senza confronto<Info title="Documenti mancanti">Le righe indicano quante lavorazioni non hanno un valore OC o una fattura disponibili. Una lavorazione può comparire in entrambi gli elenchi. L’assenza di un documento esclude soltanto i confronti che lo richiedono.</Info></h3><div className="pc-private-missing"><button onClick={()=>setSelected({title:'Lavorazioni senza OC',items:missingOc})}><span>Senza OC</span><strong>{missingOc.length}</strong><span>Mostra lavorazioni</span></button><button onClick={()=>setSelected({title:'Lavorazioni senza FT',items:missingInvoice})}><span>Senza FT</span><strong>{missingInvoice.length}</strong><span>Mostra lavorazioni</span></button></div>{saliRows.length>0&&<button className="pc-private-sali-link" onClick={()=>setSelected({title:'Sali di Ischia · escluse dai confronti',items:saliRows})}>Sali di Ischia · {saliRows.length} lavorazioni separate</button>}</article>
 </div>{selected&&<Modal className="pc-private-report" title={selected.title} onClose={()=>setSelected(null)}><PrivateReportTable rows={selected.items}/></Modal>}</>;
}
