
import {useMemo} from 'react';
import CrmRemoteDetailTable from './CrmRemoteDetailTable';


import {productAgents} from './productPurchaseDetails';
import {CrmDetailTable} from './CrmKpiDetail';
import {formatMoney} from './crmConfig';
const columns=[
 {key:'agent_name',label:'Agente',value:r=>r.agent_name},
 {key:'quantity',remoteFormat:'number',label:'Totale quantità',value:r=>Number(r.quantity).toLocaleString('it-IT'),sortValue:r=>Number(r.quantity)},
 {key:'net_amount',remoteFormat:'money',label:'Importo netto',value:r=>formatMoney(r.net_amount)+(Number(r.unknown_amounts)?' (parziale)':''),sortValue:r=>Number(r.net_amount)},
 {key:'customers',remoteFormat:'number',label:'Clienti che hanno acquistato',value:r=>r.customers,sortValue:r=>Number(r.customers)}
];
export default function CrmProductAgents({parameters={},code,rows,customer}) {
 const local=useMemo(()=>rows?productAgents(rows,customer).map(r=>({...r,net_amount:r.amount,unknown_amounts:r.unknownAmount?1:0})):null,[rows,customer]);
 if(local)return <CrmDetailTable rows={local} columns={columns}/>;
 return <CrmRemoteDetailTable source={parameters.p_order_module?'crm_b2b_order_product_agents':'crm_dashboard_product_agents'} parameters={{...parameters,p_product:code}} columns={columns}/>;
}
