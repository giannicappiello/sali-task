
import {formatDate,formatMoney} from './crmConfig';
const percent=value=>new Intl.NumberFormat('it-IT',{maximumFractionDigits:1}).format(value)+'%';
export function RevenueTrend({rows=[],totalAmount,privateAmount,directAmount}) {
 if(!rows.length)return <p className="crm-control-empty">Nessun fatturato nel periodo selezionato.</p>;
 const periodPrivate=Number(privateAmount??rows.reduce((sum,row)=>sum+Number(row.private_invoice_total||0),0));
 const periodDirect=Number(directAmount??rows.reduce((sum,row)=>sum+Number(row.direct_invoice_total||0),0));
 const periodTotal=Number(totalAmount??rows.reduce((sum,row)=>sum+Number(row.invoice_total||0),0));
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
 <div className="crm-control-trend-row crm-revenue-period-summary"><strong>Totale periodo</strong><div className="crm-revenue-summary-parts"><span>PRIVATE <strong>{formatMoney(periodPrivate)}</strong> · {periodTotal?percent(periodPrivate/periodTotal*100):'—'}</span><span>DIRECT <strong>{formatMoney(periodDirect)}</strong> · {periodTotal?percent(periodDirect/periodTotal*100):'—'}</span></div><strong className="crm-revenue-total"><small>Totale netto periodo</small>{formatMoney(periodTotal)}</strong></div>
 <footer><span><i className="private"/>PRIVATE</span><span><i className="direct"/>DIRECT · IVA esclusa</span></footer>
 </div>;
}
export function DirectRevenuePie({revenueItems=[],totalAmount,error}) {
 const colors=['#1769e0','#087f5b','#d48000','#8549c8','#64748b'];
 const items=revenueItems.map((row,i)=>({...row,color:row.color||colors[i%colors.length]}));
 const total=Number(totalAmount??items.reduce((sum,row)=>sum+Number(row.amount||0),0));

 const b2b=items.find(row=>row.label==='BtoB');
 const mypharma=Number(b2b?.mypharma_amount||0);
 const visible=items.filter(row=>Number(row.amount)>0);
 const parentIndex=visible.findIndex(row=>row.label==='BtoB');
 const childStart=-Math.PI/2+visible.slice(0,Math.max(0,parentIndex)).reduce((sum,row)=>sum+Number(row.amount)/(total||1)*Math.PI*2,0);
 const childEnd=childStart+mypharma/(total||1)*Math.PI*2;
 const point=angle=>[100+58*Math.cos(angle),100+58*Math.sin(angle)];
 const [childX1,childY1]=point(childStart),[childX2,childY2]=point(childEnd);
 const childTitle='MYPHARMA: '+formatMoney(mypharma)+' · '+(Number(b2b?.amount)>0?percent(mypharma/Number(b2b.amount)*100):'—')+' del BtoB · '+(total?percent(mypharma/total*100):'—')+' del totale DIRECT';
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
 })}
 {b2b&&mypharma>0&&mypharma<=Number(b2b.amount)&&(mypharma>=total?<circle cx="100" cy="100" r="58" fill="#92c5ff" stroke="#fff" strokeWidth="2"><title>{childTitle}</title></circle>:<path d={'M100 100 L'+childX1+' '+childY1+' A58 58 0 '+(mypharma/total>0.5?1:0)+' 1 '+childX2+' '+childY2+' Z'} fill="#92c5ff" stroke="#fff" strokeWidth="2"><title>{childTitle}</title></path>)}
 </svg>:<p>Grafico non disponibile per importi nulli o negativi.</p>}
 <div className="crm-direct-pie-legend">{items.map(row=><div className="crm-direct-pie-entry" key={row.label}><div><span><i style={{background:row.color}}/>{row.label}</span><strong>{formatMoney(row.amount)}</strong><span>{total?percent(Number(row.amount)/total*100):'—'}</span></div>{row.label==='BtoB'&&<div className="crm-direct-mypharma"><span><i style={{background:'#92c5ff'}}/>MYPHARMA · incluso nel BtoB</span><strong>{formatMoney(mypharma)}</strong><small>{Number(row.amount)>0?percent(mypharma/Number(row.amount)*100):'—'} del BtoB · {total?percent(mypharma/total*100):'—'} del totale DIRECT</small></div>}</div>)}<p>Totale netto <strong>{formatMoney(total)}</strong></p></div>
 </div></article>;
}
