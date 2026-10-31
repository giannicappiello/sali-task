
import {useId,useState} from 'react';
import {CrmDetailTable} from './CrmKpiDetail';
import {formatMoney} from './crmConfig';
import CrmProductDocumentLines from './CrmProductDocumentLines';
export default function CrmProductPurchaseTable({rows,parameters,customer}) {
 const [expanded,setExpanded]=useState({});
 const prefix=useId();
 const toggle=(id,mode)=>setExpanded(previous=>({...previous,[id]:previous[id]===mode?null:mode}));
 const control=(row,mode,label)=><button type="button" className="crm-product-expand" aria-expanded={expanded[row.code]===mode} aria-controls={expanded[row.code]?prefix+encodeURIComponent(row.code):undefined} onClick={()=>toggle(row.code,mode)}>{expanded[row.code]===mode?'▾':'▸'} {label}</button>;
 const columns=[
  {key:'description',label:'Prodotto',value:r=>r.description},
  {key:'code',label:'Codice',value:r=>r.code},
  {key:'quantity',label:'Quantità',value:r=>Number(r.quantity).toLocaleString('it-IT'),sortValue:r=>r.quantity},
  {key:'documents',label:'Documenti',value:r=>r.documents,sortValue:r=>r.documents,render:r=>control(r,'documents',r.documents)},
  {key:'amount',label:'Importo netto',value:r=>formatMoney(r.amount.value)+(r.amount.unknown?' (parziale)':''),sortValue:r=>r.amount.value},
  {key:'clients',label:'Clienti',value:()=> 'Clienti',render:r=>control(r,'customers','Clienti')}
 ];
 return <CrmDetailTable rows={rows} columns={columns} renderExpanded={row=>expanded[row.code]?<section id={prefix+encodeURIComponent(row.code)} className="crm-customer-invoice-detail" aria-label={row.description+' · '+(expanded[row.code]==='documents'?'Documenti':'Clienti')}><h3>{row.description} · {expanded[row.code]==='documents'?'Documenti':'Clienti'}</h3><CrmProductDocumentLines key={row.code} code={row.code} parameters={parameters} rows={row.lines} customer={customer} mode={expanded[row.code]}/></section>:null}/>;
}
