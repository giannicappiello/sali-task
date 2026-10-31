
import {useMemo,useState,useId} from 'react';
import {CrmDetailTable} from './CrmKpiDetail';
import {formatDate,formatMoney} from './crmConfig';
import {productCustomers,productDocuments} from './productPurchaseDetails';
const quantity = value => Number(value).toLocaleString('it-IT');
const documentColumns = [
 {key:'document_number',label:'Documento',value:r=>r.document_number},
 {key:'customer_name',label:'Cliente',value:r=>r.customer_name||'—'},
 {key:'document_date',label:'Data',value:r=>formatDate(r.document_date),sortValue:r=>r.document_date},
 {key:'quantity',label:'Quantità prodotto',value:r=>quantity(r.quantity),sortValue:r=>r.quantity},
 {key:'amount',label:'Importo netto prodotto',value:r=>r.unknownAmount?'Dato parziale':formatMoney(r.amount),sortValue:r=>r.unknownAmount?null:r.amount},
 {key:'document_status',label:'Stato',value:r=>r.document_status}
];
export default function CrmProductPurchaseDetails({lines,mode,customer}) {
 const customers=useMemo(()=>productCustomers(lines,customer),[lines,customer]);
 const documents=useMemo(()=>productDocuments(lines.map(row=>({...row,customer_code:row.customer_code||customer?.code,customer_name:row.customer_name||customer?.name}))),[lines,customer]);
 const [expanded,setExpanded]=useState(()=>new Set());
 const prefix=useId();
 const toggle=id=>setExpanded(previous=>{const next=new Set(previous);if(next.has(id))next.delete(id);else next.add(id);return next;});
 if(mode==='documents')return <CrmDetailTable rows={documents} columns={documentColumns}/>;
 const columns=[
  {key:'customer_name',label:'Cliente',value:r=>r.customer_name,searchValue:r=>r.customer_name+' '+(r.customer_code||'')},
  {key:'customer_code',label:'Codice cliente',value:r=>r.customer_code},
  {key:'quantity',label:'Quantità totale prodotto',value:r=>quantity(r.quantity),sortValue:r=>r.quantity},
  {key:'documents',label:'Documenti',value:r=>r.documents.length,sortValue:r=>r.documents.length,
   render:r=><button type="button" className="crm-product-expand" aria-expanded={expanded.has(r.id)} aria-controls={expanded.has(r.id)?prefix+encodeURIComponent(r.id):undefined} onClick={()=>toggle(r.id)}>{expanded.has(r.id)?'▾':'▸'} {r.documents.length} documenti</button>}
 ];
 return <CrmDetailTable rows={customers} columns={columns} renderExpanded={r=>expanded.has(r.id)?<section id={prefix+encodeURIComponent(r.id)} className="crm-customer-invoice-detail" aria-label={'Documenti di '+r.customer_name}><h4>{r.customer_name} · {quantity(r.quantity)} quantità totale · {r.documents.length} documenti</h4><CrmDetailTable rows={r.documents} columns={documentColumns}/></section>:null}/>;
}
