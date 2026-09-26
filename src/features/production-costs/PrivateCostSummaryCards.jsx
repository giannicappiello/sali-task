import {useState} from 'react';
import {Modal} from './common';
import {money} from './client';
import {privateProductionSummary} from './private-report';

const sum=(rows,key)=>rows.some(r=>r[key]!=null)?rows.reduce((s,r)=>s+(r[key]??0),0):null;
export default function PrivateCostSummaryCards({rows,searchCard}) {
 const [selected,setSelected]=useState(null);
 const summary=privateProductionSummary(rows);
 const matched=rows.filter(r=>r.comparisonTotal!=null&&r.workedOct!=null);
 const activate=(title,items)=>({role:'button',tabIndex:0,onClick:()=>setSelected({title,items}),onKeyDown:e=>{if(e.target===e.currentTarget&&(e.key==='Enter'||e.key===' ')){e.preventDefault();setSelected({title,items});}}});
 return <><div className="pc-cards pc-summary-cards pc-private-overview">{searchCard}
 <article className="pc-card pc-card-clickable" {...activate('Costi consuntivi',rows)}><span>Costi consuntivi</span><div className="pc-summary-line"><small>Con OCT</small><strong>{money(sum(matched,'comparisonTotal'))}</strong></div><div className="pc-summary-line"><small>Senza confronto</small><strong>{money(sum(summary.excluded,'comparisonTotal'))}</strong></div></article>
 <article className="pc-card pc-card-clickable" {...activate('Valore netto OCT',matched)}><span>Valore netto OCT</span><div className="pc-summary-line"><strong>{money(sum(matched,'workedOct'))}</strong></div></article>
 <article className="pc-card pc-card-clickable" {...activate('Differenza',matched)}><span>Differenza</span><div className="pc-summary-line">{summary.excess!=null&&<strong className="pc-balance-negative">{money(summary.excess)}</strong>}</div></article>
 </div>{selected&&<Modal title={selected.title} onClose={()=>setSelected(null)}><div className="pc-table-wrap"><table><thead><tr><th>RdP</th><th>Cliente / prodotto</th><th>OCT</th><th>Costi consuntivi</th><th>Valore netto OCT</th><th>Differenza</th></tr></thead><tbody>{selected.items.map(r=><tr key={r.id}><td>{r.order}</td><td>{r.customer}<small>{r.articleCode} · {r.description}</small></td><td>{r.octReferences.join(' · ')}</td><td>{money(r.comparisonTotal)}</td><td>{money(r.workedOct)}</td><td className="pc-balance-negative">{r.excess!=null?money(r.excess):'—'}</td></tr>)}</tbody></table></div></Modal>}</>;
}
