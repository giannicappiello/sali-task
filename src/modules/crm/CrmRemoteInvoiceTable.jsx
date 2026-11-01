
import{useState}from'react';import{Link}from'react-router-dom';
import CrmRemoteDetailTable from './CrmRemoteDetailTable';
import{formatDate,formatMoney}from'./crmConfig';
export default function CrmRemoteInvoiceTable({source,parameters,customerLink,linkDocuments=true}){
 const[expanded,setExpanded]=useState({});
 const columns=[
 {key:'customer',remoteFields:['customer_name'],label:'Cliente',value:r=>r.customer_name,render:r=><Link to={customerLink(r)}>{r.customer_name}<small>{r.customer_code}</small></Link>},
 {key:'customer_code',label:'Codice',value:r=>r.customer_code},
 {key:'documents',remoteFormat:'number',label:'Documenti',value:r=>r.documents,render:r=><button type="button" aria-expanded={!!expanded[r.customer_code]} onClick={()=>setExpanded(p=>({...p,[r.customer_code]:!p[r.customer_code]}))}>{expanded[r.customer_code]?'▾':'▸'} {r.documents}</button>},
 {key:'last_invoice',remoteFormat:'date',label:'Ultima fattura',value:r=>formatDate(r.last_invoice)},
 {key:'invoice_total',remoteFormat:'money',label:'Fatturato netto',value:r=>formatMoney(r.invoice_total)}];
 const docs=[{key:'title',label:'Documento',value:r=>r.title,render:r=>linkDocuments?<Link to={'/ordini-private/fatture/'+r.id}>{r.title}</Link>:r.title},
 {key:'document_date',remoteFormat:'date',label:'Data',value:r=>formatDate(r.document_date)},
 {key:'amount',remoteFormat:'money',label:'Imponibile',value:r=>formatMoney(r.amount)}];
 return <CrmRemoteDetailTable source={source} parameters={parameters} transform="invoice_customers" columns={columns} renderExpanded={r=>expanded[r.customer_code]?<section className="crm-customer-invoice-detail"><h3>{r.customer_name} · Fatture</h3><CrmRemoteDetailTable source={source} parameters={parameters} customerCode={r.customer_code} columns={docs}/></section>:null}/>;
}
