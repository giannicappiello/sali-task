import {InvoiceCells,InvoiceHeaders} from "./InvoiceSummary";
import PrivateCostSummaryCards from "./PrivateCostSummaryCards";
import {useEffect,useMemo,useState} from 'react';
import {useAuth} from '../../contexts/AuthContext';
import {action,money,quantity,date} from './client';
import {Modal} from './common';
import './production-costs.css';
export default function PrivateProductionCostReports(){
 const {session}=useAuth(),token=session?.access_token;
 const [records,setRecords]=useState([]),[query,setQuery]=useState(''),[selected,setSelected]=useState(null),[error,setError]=useState(''),[loading,setLoading]=useState(true),[revision,setRevision]=useState(0);
 useEffect(()=>{if(!token)return;let active=true;action(token,'private-list').then(r=>{if(active){setRecords(r.records);setError('');setSelected(null);}}).catch(e=>{if(active)setError(e.message);}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};},[token,revision]);
 const rows=useMemo(()=>records.filter(r=>r.state==='Conclusa'&&[r.order,r.customer,r.articleCode,r.description,...r.octReferences].join(' ').toLocaleLowerCase('it-IT').includes(query.toLocaleLowerCase('it-IT'))),[records,query]);
 const searchCard=<section className="pc-panel pc-private-search"><div className="pc-fields"><label className="pc-field"><span>Ricerca RdP, OC, cliente o prodotto</span><input value={query} onChange={e=>setQuery(e.target.value)}/></label><button disabled={loading} onClick={()=>{setLoading(true);setError('');setSelected(null);setRevision(v=>v+1);}}>Aggiorna</button></div></section>;
 return <div className="pc-page pc-private-report"><PrivateCostSummaryCards rows={rows} searchCard={searchCard}/>

 {error&&<p role="alert">{error}</p>}{loading?<p role="status">Caricamento consuntivi…</p>:<>
 <section className="pc-panel"><h2>RdP / OC conclusi · {quantity(rows.length)}</h2><div className="pc-table-wrap"><table><thead><tr><th>RdP / OC</th><th>Cliente</th><th>Prodotto</th><th>Differenza</th><InvoiceHeaders/><th></th></tr></thead><tbody>{rows.map(r=><tr key={r.id}><td>{r.order}<small>{r.octReferences.join(' · ')}</small></td><td>{r.customer}</td><td>{r.articleCode}<small>{r.description}</small></td><td className="pc-balance-negative">{r.excess!=null?money(r.excess):'—'}</td><InvoiceCells invoice={r.invoiceValue} oc={r.workedOct} actual={r.comparisonTotal} references={r.invoiceReferences}/><td>{r.excess!=null&&r.detail&&<button onClick={()=>setSelected(r)}>Apri dettaglio</button>}</td></tr>)}</tbody></table></div>{!rows.length&&<p>Nessuna produzione disponibile.</p>}</section></>}
 {selected?.excess!=null&&selected.detail&&<Modal title={`Consuntivo · ${selected.order}`} onClose={()=>setSelected(null)}><p>{selected.articleCode} · {selected.description}</p><p>Quantità lavorata: {quantity(selected.detail.workedQuantity)} {selected.detail.unit}</p><table><thead><tr><th>Valore netto OC</th><th>Costi consuntivi</th><th>Differenza</th><InvoiceHeaders/></tr></thead><tbody><tr><td>{money(selected.workedOct)}</td><td>{money(selected.comparisonTotal)}</td><td className="pc-balance-negative">{money(selected.excess)}</td><InvoiceCells invoice={selected.invoiceValue} oc={selected.workedOct} actual={selected.comparisonTotal} references={selected.invoiceReferences}/></tr></tbody></table><h3>Lavorazioni</h3><div className="pc-table-wrap"><table><thead><tr><th>Fase</th><th>Inizio</th><th>Fine</th><th>Ore effettive</th><th>Quantità</th></tr></thead><tbody>{selected.detail.phases.map(p=><tr key={p.id}><td>{p.phase}</td><td>{date(p.start)}</td><td>{date(p.end)}</td><td>{quantity(p.hours)}</td><td>{quantity(p.quantity)}</td></tr>)}</tbody></table></div></Modal>}
 </div>;
}
