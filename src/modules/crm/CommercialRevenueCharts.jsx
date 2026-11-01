
import {formatDate,formatMoney} from './crmConfig';
const percent=value=>new Intl.NumberFormat('it-IT',{maximumFractionDigits:1}).format(value)+'%';
export function RevenueTrend({rows=[]}) {
 if(!rows.length)return <p className="crm-control-empty">Nessun fatturato nel periodo selezionato.</p>;
 const max=Math.max(1,...rows.map(row=>Number(row.invoice_total||0)));
 return <div className="crm-control-trend" aria-label="Composizione fatturato netto PRIVATE e DIRECT">
 {rows.map(row=>{
  const total=Number(row.invoice_total||0);
  const values=[['PRIVATE','private',Number(row.private_invoice_total||0)],['DIRECT','direct',Number(row.direct_invoice_total||0)]];
  return <div className="crm-control-trend-row" key={row.bucket}>
   <time>{formatDate(row.bucket)}</time>
   <div className="crm-revenue-track"><div className="crm-revenue-stack" style={{width:Math.max(0,total/max*100)+'%'}}>
    {values.map(([name,css,value])=><div key={name} className={'crm-revenue-segment '+css} style={{width:(total>0?Math.max(0,value/total*100):0)+'%'}} title={name+': '+formatMoney(value)+' · '+(total?percent(value/total*100):'—')}>
     <strong>{formatMoney(value)}</strong><small>{total?percent(value/total*100):'—'}</small>
    </div>)}
   </div></div>
   <strong className="crm-revenue-total"><small>Totale netto</small>{formatMoney(total)}</strong>
  </div>;
 })}
 <footer><span><i className="private"/>PRIVATE</span><span><i className="direct"/>DIRECT · IVA esclusa</span></footer>
 </div>;
}
export function DirectRevenuePie({revenueItems=[],totalAmount,error}) {
 const colors=['#1769e0','#087f5b','#d48000','#8549c8','#64748b'];
 const items=revenueItems.map((row,i)=>({...row,color:row.color||colors[i%colors.length]}));
 const total=Number(totalAmount??items.reduce((sum,row)=>sum+Number(row.amount||0),0));

 const valid=total>0&&items.every(row=>Number(row.amount)>=0);
 return <article className="crm-direct-revenue-pie"><h4>Composizione DIRECT</h4><small>Fatturato IVA esclusa · Estero separato dagli altri canali</small>{error?<p role="alert">{error}</p>:null}
 <div className="crm-direct-pie-content">
 {valid?<svg viewBox="0 0 200 200" role="img" aria-label="Ripartizione del fatturato netto DIRECT">
 {items.filter(row=>Number(row.amount)>0).map((row,index,visible)=>{
  const share=Number(row.amount)/total;
  const start=-Math.PI/2+visible.slice(0,index).reduce((sum,item)=>sum+Number(item.amount)/total*Math.PI*2,0);
  const angle=start+share*Math.PI*2;
  const point=a=>[100+90*Math.cos(a),100+90*Math.sin(a)];
  const [x1,y1]=point(start),[x2,y2]=point(angle);
  return share>=1?<circle key={row.label} cx="100" cy="100" r="90" fill={row.color}><title>{row.label+': '+formatMoney(row.amount)+' · '+percent(share*100)}</title></circle>:<path key={row.label} d={'M100 100 L'+x1+' '+y1+' A90 90 0 '+(share>0.5?1:0)+' 1 '+x2+' '+y2+' Z'} fill={row.color} stroke="#fff" strokeWidth="1"><title>{row.label+': '+formatMoney(row.amount)+' · '+percent(share*100)}</title></path>;
 })}</svg>:<p>Grafico non disponibile per importi nulli o negativi.</p>}
 <div className="crm-direct-pie-legend">{items.map(row=><div key={row.label}><span><i style={{background:row.color}}/>{row.label}</span><strong>{formatMoney(row.amount)}</strong><span>{total?percent(Number(row.amount)/total*100):'—'}</span></div>)}<p>Totale netto <strong>{formatMoney(total)}</strong></p></div>
 </div></article>;
}
