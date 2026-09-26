import {useState} from 'react';
import {Modal} from './common';
import {money,signedMoney} from './client';
export const invoiceDifference=(a,b)=>a!=null&&b!=null?a-b:null;
export function InvoiceBalance({value}){return <span className={value>0?'pc-balance-positive':value<0?'pc-balance-negative':''}>{value==null?'—':signedMoney(value)}</span>;}
export function InvoiceCells({invoice,oc,actual,references=[]}){return <><td>{invoice==null?<span className="pc-invoice-missing">Fattura non ancora emessa</span>:money(invoice)}<small>{references.join(' · ')}</small></td><td><InvoiceBalance value={invoiceDifference(invoice,oc)}/></td><td><InvoiceBalance value={invoiceDifference(invoice,actual)}/></td></>;}
export const InvoiceHeaders=()=> <><th>Fatturato / fattura</th><th>Fatturato − OC</th><th>Fatturato − consuntivo</th></>;
export default function InvoiceSummary({rows}){
 const [open,setOpen]=useState(false),known=rows.filter(r=>r.invoice!=null),missing=rows.length-known.length;
 const sum=key=>known.length?known.reduce((s,r)=>s+(r[key]??0),0):null;
 const delta=key=>{const pairs=known.filter(r=>r[key]!=null);return pairs.length?pairs.reduce((s,r)=>s+r.invoice-r[key],0):null;};
 return <><article className="pc-card pc-card-clickable pc-invoice-card" role="button" tabIndex={0} onClick={()=>setOpen(true)} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();setOpen(true);}}}><span>Fatturato</span><div className="pc-summary-line"><small>Netto</small><strong>{money(sum('invoice'))}</strong></div><div className="pc-summary-line"><small>Fatturato − OC</small><strong><InvoiceBalance value={delta('oc')}/></strong></div><div className="pc-summary-line"><small>Fatturato − consuntivo</small><strong><InvoiceBalance value={delta('actual')}/></strong></div><small className="pc-invoice-coverage">{known.length} lavorazioni fatturate{missing>0&&` · ${missing} senza fattura, escluse dai conteggi del fatturato`}</small></article>{open&&<Modal title="Fatturato · lavorazioni concluse" onClose={()=>setOpen(false)}><p>{known.length} lavorazioni fatturate. {missing} senza fattura, escluse dal totale fatturato e dai relativi confronti con OC e consuntivo.</p><div className="pc-table-wrap"><table><thead><tr><th>RdP / OC</th><th>Prodotto</th><th>Valore netto OC</th><th>Consuntivo</th><InvoiceHeaders/></tr></thead><tbody>{rows.map(r=><tr key={r.id}><td>{r.order}</td><td>{r.article}</td><td>{money(r.oc)}</td><td>{money(r.actual)}</td><InvoiceCells invoice={r.invoice} oc={r.oc} actual={r.actual} references={r.references}/></tr>)}</tbody></table></div></Modal>}</>;
}
