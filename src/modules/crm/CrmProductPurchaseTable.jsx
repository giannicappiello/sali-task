
import {useId,useMemo,useState} from 'react';
import CrmRemoteDetailTable from './CrmRemoteDetailTable';
import {CrmDetailTable} from './CrmKpiDetail';
import {formatMoney} from './crmConfig';
import {productCustomers,productAgents} from './productPurchaseDetails';
import CrmProductAgents from './CrmProductAgents';
import CrmProductDocumentLines from './CrmProductDocumentLines';
export default function CrmProductPurchaseTable({rows=[],parameters,customer,remote=false}) {
 const products=useMemo(()=>rows.map(row=>({...row,customers:row.lines?productCustomers(row.lines,customer).length:row.customers,agents:row.lines?productAgents(row.lines,customer).filter(a=>a.id).length:row.agents})),[rows,customer]);
 const [expanded,setExpanded]=useState({});
 const prefix=useId();
 const toggle=(id,mode)=>setExpanded(previous=>({...previous,[id]:previous[id]===mode?null:mode}));
 const control=(row,mode,label)=><button type="button" className="crm-product-expand" aria-expanded={expanded[row.code]===mode} aria-controls={expanded[row.code]?prefix+encodeURIComponent(row.code):undefined} onClick={()=>toggle(row.code,mode)}>{expanded[row.code]===mode?'▾':'▸'} {label}</button>;
 const columns=[
  {key:'description',label:'Prodotto',value:r=>r.description},
  {key:'code',label:'Codice',value:r=>r.code},
  {key:'quantity',remoteFormat:'number',label:'Quantità',value:r=>Number(r.quantity).toLocaleString('it-IT'),sortValue:r=>r.quantity},
  {key:'amount',remoteFields:['net_amount'],remoteFormat:'money',label:'Importo netto',value:r=>formatMoney(r.amount.value)+(r.amount.unknown?' (parziale)':''),sortValue:r=>r.amount.value},
  {key:'documents',remoteFormat:'number',label:'Documenti',value:r=>r.documents,sortValue:r=>r.documents,render:r=>control(r,'documents',r.documents)},
  {key:'clients',remoteFields:['customers'],remoteFormat:'number',label:'Clienti',value:r=>r.customers,sortValue:r=>r.customers,render:r=>control(r,'customers',r.customers??'—')},
  {key:'agents',remoteFormat:'number',label:'Agenti',value:r=>r.agents,sortValue:r=>r.agents,render:r=>control(r,'agents',r.agents??'—')}
 ];
 const renderExpanded=row=>expanded[row.code]?<section id={prefix+encodeURIComponent(row.code)} className="crm-customer-invoice-detail" aria-label={row.description+' · '+(expanded[row.code]==='documents'?'Documenti':expanded[row.code]==='agents'?'Agenti':'Clienti')}><h3>{row.description} · {expanded[row.code]==='documents'?'Documenti':expanded[row.code]==='agents'?'Agenti':'Clienti'}</h3><>{expanded[row.code]==='agents'?<CrmProductAgents key={row.code} code={row.code} parameters={parameters} rows={row.lines} customer={customer}/>:<CrmProductDocumentLines key={row.code} code={row.code} parameters={parameters} rows={row.lines} customer={customer} mode={expanded[row.code]}/>}</></section>:null;
 return remote?<CrmRemoteDetailTable source={parameters.p_order_module?'crm_b2b_order_product_groups_with_agents':'crm_dashboard_product_groups_with_agents'} parameters={parameters} columns={columns} mapRow={row=>({...row,amount:{value:Number(row.net_amount),unknown:Number(row.unknown_amounts)}})} renderExpanded={renderExpanded}/>:<CrmDetailTable rows={products} columns={columns} renderExpanded={renderExpanded}/>;
}
