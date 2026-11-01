
import CrmRemoteDetailTable from './CrmRemoteDetailTable';
import CrmRemoteInvoiceTable from './CrmRemoteInvoiceTable';
import {Link} from 'react-router-dom';
import {CrmKpiDialog} from './CrmKpiDetail';


import {formatDate,formatMoney} from './crmConfig';
const COMMERCIAL_CARD_METRICS={
 'Fatturato':'invoices','OCT aperti':'oct','Clienti Mexal attivi':'customers','Nuovi clienti':'new','Clienti persi':'lost'
};
function customerPath(row){
 const area=row.crm_area||row.invoices?.[0]?.crm_area;
 const base=area==='conto_terzi'?'/crm/conto-terzi':area==='online'?'/crm/online':'/crm/b2b';
 return base+'/clienti/'+encodeURIComponent('mexal:'+row.customer_code);
}
export default function CrmCommercialMetricDialog({title,filters,onClose}){
 const metric=COMMERCIAL_CARD_METRICS[title];
 const clients=['customers','new','lost'].includes(metric);
 const columns=[
  ...(!clients?[{key:'title',label:'Documento',value:r=>r.title}]:[]),
  {key:'customer',remoteFields:['customer_name'],label:'Cliente',value:r=>r.customer_name,render:r=><Link to={customerPath(r)}>{r.customer_name}<small>{r.customer_code}</small></Link>},
  {key:'date',remoteFields:['document_date'],remoteFormat:'date',label:metric==='new'?'Prima vendita':'Ultimo documento',value:r=>formatDate(r.document_date),sortValue:r=>r.document_date},
  {key:'amount',remoteFormat:'money',label:clients?'Fatturato netto nel periodo':'Importo netto',value:r=>formatMoney(r.amount),sortValue:r=>Number(r.amount)}
 ];
 return <CrmKpiDialog title={title} subtitle={formatDate(filters.p_from)+' – '+formatDate(filters.p_to)+' · filtri della dashboard · IVA esclusa'} onClose={onClose}>
 {metric==='invoices'?<CrmRemoteInvoiceTable source="crm_commercial_dashboard_details" parameters={{...filters,p_metric:metric}} customerLink={customerPath} linkDocuments={false}/>:<CrmRemoteDetailTable source="crm_commercial_dashboard_details" parameters={{...filters,p_metric:metric}} columns={columns}/>}

 </CrmKpiDialog>;
}
