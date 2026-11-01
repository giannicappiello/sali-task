
import{useState}from'react';import{Link}from'react-router-dom';import CrmRemoteDetailTable from './CrmRemoteDetailTable';
import{formatDate,formatMoney}from'./crmConfig';
export default function CrmRemoteProductBreakdown({parameters,code,mode,customerCode=null}){
 const[expanded,setExpanded]=useState({});
 const source=parameters.p_order_module?'crm_b2b_order_product_detail_lines':'crm_dashboard_product_detail_lines';
 const args={...parameters,p_product:code};
 const expand=(r,key,label)=><button type="button" aria-expanded={!!expanded[r[key]]} onClick={()=>setExpanded(p=>({...p,[r[key]]:!p[r[key]]}))}>{expanded[r[key]]?'▾':'▸'} {label}</button>;
 const client={key:'customer_name',label:'Cliente',value:r=>r.customer_name,render:r=><Link to={'/crm/'+(parameters.p_crm_type==='conto_terzi'?'conto-terzi':parameters.p_crm_type)+'/clienti/'+encodeURIComponent('mexal:'+r.customer_code)}>{r.customer_name}</Link>};
 const quantity={key:'quantity',remoteFormat:'number',label:'Quantità',value:r=>Number(r.quantity).toLocaleString('it-IT')};
 const amount={key:'net_amount',remoteFormat:'money',label:'Importo netto',value:r=>formatMoney(r.net_amount)+(Number(r.unknown_amounts)?' (parziale)':'')};
 const documents=[{key:'document_number',label:'Documento',value:r=>r.document_number,render:r=>expand(r,'document_id',r.document_number)},client,{key:'document_date',remoteFormat:'date',label:'Data',value:r=>formatDate(r.document_date)},quantity,amount,{key:'document_status',label:'Stato',value:r=>r.document_status}];
 const customers=[client,{key:'customer_code',label:'Codice cliente',value:r=>r.customer_code},quantity,amount,{key:'documents',remoteFormat:'number',label:'Documenti',value:r=>r.documents,render:r=>expand(r,'customer_code',r.documents)}];
 const lines=[{key:'description',label:'Prodotto',value:r=>r.description},{key:'product_code',label:'Codice',value:r=>r.product_code},quantity,amount];
 return <CrmRemoteDetailTable source={source} parameters={args} customerCode={customerCode} transform={mode==='customers'?'product_customers':'product_documents'} columns={mode==='customers'?customers:documents}
 renderExpanded={r=>expanded[mode==='customers'?r.customer_code:r.document_id]?<section className="crm-customer-invoice-detail">{mode==='customers'?<CrmRemoteProductBreakdown parameters={parameters} code={code} mode="documents" customerCode={r.customer_code}/>:<CrmRemoteDetailTable source={source} parameters={args} customerCode={customerCode} documentId={r.document_id} columns={lines}/>}</section>:null}/>;
}
