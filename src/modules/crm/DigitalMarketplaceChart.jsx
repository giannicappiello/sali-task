import { amountBasisNote } from './digitalOrderValueModel.js';
import { useState } from 'react';
import { displayAmounts } from './digitalDashboardModel.js';
import './digital-marketplace-chart.css';

const COLORS = ['#126bff','#20a67a','#f0a728','#8857cc','#e45d77','#168fa8','#75624d','#52734d'];
export default function DigitalMarketplaceChart({ rows, onOpen }) {
  const [selectedCurrency,setSelectedCurrency] = useState('EUR');
  const currencies = [...new Set(rows.map(row=>row.currency))];
  const currency = currencies.includes(selectedCurrency) ? selectedCurrency : currencies[0];
  const current = rows.filter(row=>row.currency===currency);
  const value = row => row.amounts.totals[0]?.amount || 0;
  const total = current.reduce((sum,row)=>sum+Math.max(0,value(row)),0);
  const slices = current.reduce((result,row,index)=>{
    const start=result.at(-1)?.end || 0;
    return [...result,{row,color:COLORS[index%COLORS.length],start,end:start+(total ? Math.max(0,value(row))/total*100 : 0)}];
  },[]);
  return <section className="panel crm-panel crm-marketplace-chart" aria-label="Ordinato per marketplace">
    <header><div><h2>Ordinato per marketplace</h2><p>Torta e media usano i totali netti confermati nel periodo. Il valore da evadere include gli importi disponibili negli ordini, con le stime indicate separatamente. Annullati e falliti esclusi.</p></div>{currencies.length>1 ? <label>Valuta<select value={currency} onChange={event=>setSelectedCurrency(event.target.value)}>{currencies.map(code=><option key={code}>{code}</option>)}</select></label> : null}</header>
    {!current.length ? <p>Nessun ordine nel periodo selezionato.</p> : <div className="crm-marketplace-content">
      <figure>{total>0 ? <div className="crm-marketplace-pie" role="img" aria-label={`Distribuzione dell’ordinato noto per marketplace in ${currency}`} style={{background:`conic-gradient(${slices.map(slice=>`${slice.color} ${slice.start}% ${slice.end}%`).join(',')})`}}/> : <p>Importi non disponibili per il grafico.</p>}<figcaption>Seleziona un marketplace nella tabella per aprire gli ordini.{current.some(row=>row.amounts.missing) ? ' Importi parziali: gli ordini senza valore restano nel conteggio.' : ''}{current.some(row=>value(row)<0) ? ' I valori negativi sono riportati in tabella ed esclusi dalla torta.' : ''}</figcaption></figure>
      <div className="crm-table-wrap"><table className="crm-table" data-column-controls="off"><thead><tr><th>Marketplace</th><th>Valore evasi</th><th>Valore da evadere</th><th>Ordinato netto noto</th><th>Numero ordini</th><th>Valore medio ordine</th></tr></thead><tbody>{slices.map(({row,color})=><tr key={row.id}><td><button type="button" className="crm-marketplace-open" onClick={()=>onOpen(row)}><span aria-hidden="true" style={{background:color}}/>{row.label}</button></td><td>{displayAmounts(row.fulfilled.amounts)}</td><td>{displayAmounts(row.waiting.amounts)}{amountBasisNote(row.waiting.amounts) ? <small>{amountBasisNote(row.waiting.amounts)}</small> : null}</td><td>{displayAmounts(row.amounts)}{row.amounts.missing ? <small>{row.amounts.missing} senza importo netto</small> : null}</td><td>{row.orders.length.toLocaleString('it-IT')}</td><td>{displayAmounts(row.averages)}{row.amounts.missing ? <small>Su {row.amounts.known} ordini con importo</small> : null}</td></tr>)}</tbody></table></div>
    </div>}
  </section>;
}
