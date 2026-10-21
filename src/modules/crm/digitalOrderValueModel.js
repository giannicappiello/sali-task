import { orderDisplayAmount } from '../../../shared/amazonOrderAmounts.js';
import { fulfillmentBucket } from './digitalSalesDayModel.js';
import { marketplaceLabel } from './marketplaceLabel.js';

export function knownAmounts(rows, field = 'net_revenue') {
  const totals = new Map(); let missing = 0;
  for (const row of rows) {
    if (row[field] == null || !Number.isFinite(Number(row[field]))) { missing++; continue; }
    const currency = row.currency || 'EUR';
    totals.set(currency, (totals.get(currency) || 0) + Number(row[field]));
  }
  return { totals: [...totals].map(([currency, amount]) => ({ currency, amount: Math.round(amount * 100) / 100 })), missing, known: rows.length - missing };
}

export function combineAmounts(groups) {
  const amounts = knownAmounts(groups.flatMap(group => group?.totals || []).map(row => ({...row,net_revenue:row.amount})));
  return {...amounts,estimated:groups.reduce((sum,row)=>sum+(row?.estimated || 0),0),gross:groups.reduce((sum,row)=>sum+(row?.gross || 0),0),known:groups.reduce((sum,row)=>sum+(row?.known || 0),0),missing:groups.reduce((sum,row)=>sum+(row?.missing || 0),0)};
}

export function averageAmounts(rows) {
  const amounts = knownAmounts(rows);
  return {...amounts,totals:amounts.totals.map(row=>({...row,amount:row.amount/rows.filter(order=>(order.currency || 'EUR')===row.currency && order.net_revenue != null && Number.isFinite(Number(order.net_revenue))).length}))};
}

export function fulfillmentSummary(orders) {
  const fulfilled = orders.filter(order=>fulfillmentBucket(order)==='fulfilled');
  const waiting = orders.filter(order=>fulfillmentBucket(order)==='waiting');
  const eligible = orders.filter(order=>fulfillmentBucket(order)!=='other');
  return {orders:eligible,fulfilled:{orders:fulfilled,amounts:knownAmounts(fulfilled)},waiting:{orders:waiting,amounts:availableWaitingAmounts(waiting),netAmounts:knownAmounts(waiting)},amounts:knownAmounts(eligible),averages:averageAmounts(eligible)};
}

export function marketplaceBreakdown(orders, connections = []) {
  const groups = new Map(), byId = new Map(connections.map(row=>[row.id,row]));
  for (const order of fulfillmentSummary(orders).orders) {
    const currency = order.currency || 'EUR', connection = byId.get(order.connection_id);
    const site = !order.marketplace || order.marketplace === 'website';
    let label = marketplaceLabel(order.marketplace,'Sito ecommerce');
    if (site) {
      try { label = new URL(connection?.site_url).hostname; }
      catch { label = connection?.nome || 'Sito ecommerce'; }
    }
    const key = JSON.stringify([site ? order.connection_id : order.marketplace,currency]);
    if (!groups.has(key)) groups.set(key,{id:key,label,currency,orders:[]});
    groups.get(key).orders.push(order);
  }
  return [...groups.values()].map(row=>({...row, ...fulfillmentSummary(row.orders)})).sort((a,b)=>a.currency.localeCompare(b.currency)||a.label.localeCompare(b.label));
}

export function availableWaitingAmounts(orders) {
  const values=orders.map(order=>({...order,display:orderDisplayAmount(order)}));
  return {...knownAmounts(values.map(row=>({...row,display_amount:row.display.amount})),'display_amount'),estimated:values.filter(row=>row.display.basis==='products').length,gross:values.filter(row=>row.display.basis==='gross').length};
}
export function amountBasisNote(amounts) {
  return [amounts?.estimated ? amounts.estimated+' importi provvisori' : '',amounts?.gross ? amounts.gross+' totali IVA inclusa' : ''].filter(Boolean).join(' · ');
}
