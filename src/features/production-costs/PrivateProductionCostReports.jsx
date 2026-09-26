import PrivateReportTable from './PrivateReportTable';
import {InvoiceCells,InvoiceHeaders} from "./InvoiceSummary";
import PrivateCostSummaryCards from "./PrivateCostSummaryCards";
import {useEffect,useMemo,useState} from 'react';
import {useAuth} from '../../contexts/AuthContext';
import {action,money,quantity,date} from './client';
import {Modal} from './common';
import './production-costs.css';
export default function PrivateProductionCostReports(){
 const {session}=useAuth(),token=session?.access_token;
 const [records,setRecords]=useState([]),[query,setQuery]=useState(''),[selected,setSelected]=useState(null),[error,setError]=useState(''),[loading,setLoading]=useState(true),[revision,setRevision]=useState(0),[invoiceState,setInvoiceState]=useState('all');
 useEffect(()=>{if(!token)return;let active=true;action(token,'private-list').then(r=>{if(active){setRecords(r.records);setError('');setSelected(null);}}).catch(e=>{if(active)setError(e.message);}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};},[token,revision]);
 const filtered=useMemo(()=>records.filter(r=>r.state==='Conclusa'&&(invoiceState==='all'||(invoiceState==='available'?r.invoiceValue!=null:r.invoiceValue==null))&&[r.order,r.customer,r.articleCode,r.description,...r.octReferences,...(r.invoiceReferences||[])].join(' ').toLocaleLowerCase('it-IT').includes(query.toLocaleLowerCase('it-IT'))),[records,query,invoiceState]);
 const rows=filtered.filter(r=>!r.isSali),saliRows=filtered.filter(r=>r.isSali);
 const searchCard=<section className="pc-panel pc-private-search"><div className="pc-fields"><label className="pc-field"><span>Ricerca OC, cliente, prodotto o fattura</span><input value={query} onChange={e=>setQuery(e.target.value)}/></label><label className="pc-field"><span>Stato fatture</span><select value={invoiceState} onChange={e=>setInvoiceState(e.target.value)}><option value="all">Tutte</option><option value="available">Disponibili</option><option value="missing">Non disponibili</option></select></label><button disabled={loading} onClick={()=>{setLoading(true);setError('');setSelected(null);setRevision(v=>v+1);}}>Aggiorna</button></div></section>;
 return <div className="pc-page pc-private-report">{searchCard}<PrivateCostSummaryCards rows={rows} saliRows={saliRows}/>

 {error&&<p role="alert">{error}</p>}{loading?<p role="status">Caricamento consuntivi…</p>:<>
 <section className="pc-panel"><h2>Produzioni concluse · {quantity(rows.length)}</h2><PrivateReportTable rows={rows} onDetail={setSelected}/></section></>}

 {selected?.excess!=null&&selected.detail&&<Modal className="pc-private-report" title={`Consuntivo · ${selected.octReferences.join(' · ')||selected.order}`} onClose={()=>setSelected(null)}><p>{selected.articleCode} · {selected.description}</p><p>Quantità lavorata: {quantity(selected.detail.workedQuantity)} {selected.detail.unit}</p><table><thead><tr><th>Valore netto OC</th><th>Costi consuntivi</th><th>Differenza</th><InvoiceHeaders/></tr></thead><tbody><tr><td>{money(selected.workedOct)}</td><td>{money(selected.comparisonTotal)}</td><td className="pc-balance-negative">{money(selected.excess)}</td><InvoiceCells invoice={selected.invoiceValue} oc={selected.workedOct} actual={selected.comparisonTotal} references={selected.invoiceReferences}/></tr></tbody></table><h3>Lavorazioni</h3><div className="pc-table-wrap"><table><thead><tr><th>Fase</th><th>Inizio</th><th>Fine</th><th>Ore effettive</th><th>Quantità</th></tr></thead><tbody>{selected.detail.phases.map(p=><tr key={p.id}><td>{p.phase}</td><td>{date(p.start)}</td><td>{date(p.end)}</td><td>{quantity(p.hours)}</td><td>{quantity(p.quantity)}</td></tr>)}</tbody></table></div></Modal>}
 </div>;
}
