import {useEffect,useMemo,useState} from 'react';
import {supabase} from '../../lib/supabaseClient';
import {loadAllQueryRows} from './crmDataset';
import {formatDate,formatMoney} from './crmConfig';
import AmazonCoxStatus from './AmazonCoxStatus';

const day=value=>{
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Rome',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(value));
 return ['year','month','day'].map(key=>parts.find(p=>p.type===key).value).join('-');
};
const labels={pending:'Da emettere',processing:'Invio in corso',blocked:'Da completare',reconciliation_required:'Da riconciliare',emitted:'Emesso'};

export default function AmazonRefunds({connections,period,refreshKey}){
 const [rows,setRows]=useState([]),[error,setError]=useState(''),[loading,setLoading]=useState(false),[filter,setFilter]=useState(''),[page,setPage]=useState(0);
 const ids=connections.filter(c=>c.provider_code==='amazon_sp_api').map(c=>c.id).sort().join(',');
 useEffect(()=>{
  let active=true;
  const timer=window.setTimeout(async()=>{
   if(!ids){setRows([]);setLoading(false);return;}
   setLoading(true);setError('');
   const from=new Date(Date.parse(period.from+'T00:00:00Z')-86400000).toISOString();
   const result=await loadAllQueryRows((start,end)=>supabase.from('crm_amazon_refunds').select('id,amazon_order_id,posted_at,gross,net,tax,items,source_status,export_status,cox_reference,error,disposition_summary').in('connection_id',ids.split(',')).gte('posted_at',from).lte('posted_at',period.to+'T23:59:59.999Z').order('posted_at',{ascending:false}).order('id').range(start,end));
   if(!active)return;
   if(result.error)setError(result.error.message);
   else setRows((result.data || []).filter(row=>day(row.posted_at)>=period.from && day(row.posted_at)<=period.to));
   setLoading(false);setPage(0);
  },0);
  return ()=>{active=false;window.clearTimeout(timer);};
 },[ids,period.from,period.to,refreshKey]);
 const filtered=useMemo(()=>rows.filter(row=>row.amazon_order_id.includes(filter.trim())),[rows,filter]);
 const visible=filtered.slice(page*25,(page+1)*25),total=filtered.reduce((sum,row)=>sum+Number(row.gross || 0),0);
 const warning=connections.find(c=>c.provider_code==='amazon_sp_api' && c.amazon_refund_state?.lastError)?.amazon_refund_state.lastError;
 return <section className="panel crm-panel"><h3>Rimborsi Amazon · {filtered.length}</h3>
  <p>COX con quantità negative dalla data del rimborso. L’articolo rientra nel magazzino 4 solo dopo conferma Amazon di vendibilità; altrimenti viene usato RESOAMAZON. Le conferme successive aggiornano lo stesso COX.</p>
  {warning?<div className="crm-message error">Sincronizzazione rimborsi da riprendere: {warning}</div>:null}
  {error?<div className="crm-message error">{error}</div>:null}
  <label>Cerca numero ordine <input value={filter} onChange={event=>{setFilter(event.target.value);setPage(0);}} placeholder="Numero ordine Amazon"/></label>
  <p>Totale rimborsi nel periodo: <strong>{formatMoney(-total)}</strong>{loading?' · Caricamento…':''}</p>
  <div className="crm-table-wrap"><table className="crm-table"><thead><tr><th>Data rimborso</th><th>Ordine</th><th>Prodotti e rientro merce</th><th>Importo</th><th>COX reso</th></tr></thead><tbody>
   {visible.map(row=><tr key={row.id}><td>{formatDate(row.posted_at)}</td><td>{row.amazon_order_id}{row.source_status==='DEFERRED'?<small> · Differito da Amazon</small>:null}</td><td>{row.items.map(item=>{
    const confirmation=row.disposition_summary?.items?.find(d=>d.line_id===item.line_id),sellable=confirmation?.sellableQuantity || 0;
    return <div key={item.line_id}>{item.sku} · {item.quantity} pz <small>{sellable?`${sellable} vendibili confermati`:confirmation?.physicalStatus==='NOT_SELLABLE'?'RESOAMAZON: non vendibile':'RESOAMAZON: vendibilità non confermata'}</small></div>;
   })}</td><td>{row.gross==null?'Da verificare':formatMoney(-Number(row.gross))}</td><td><span>{labels[row.export_status] || row.export_status} · </span><AmazonCoxStatus status={row.cox_reference?'emitted':null} reference={row.cox_reference} error={row.error}/>{!row.cox_reference && row.error?<small>{row.error}</small>:null}</td></tr>)}
  </tbody></table>{!visible.length && !loading?<div className="crm-empty">Nessun rimborso acquisito nel periodo selezionato.</div>:null}</div>
  <div className="crm-pagination"><button type="button" disabled={!page} onClick={()=>setPage(p=>p-1)}>Precedente</button><span>Pagina {page+1} · {filtered.length} rimborsi</span><button type="button" disabled={(page+1)*25>=filtered.length} onClick={()=>setPage(p=>p+1)}>Successiva</button></div>
 </section>;
}
