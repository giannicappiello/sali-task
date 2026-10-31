import { netSalesLineAmount } from './netRevenue.js';
const numeric = value => value == null || value === '' || !Number.isFinite(Number(value)) ? null : Number(value);
export function amazonProductsPreview(lines, currency = 'EUR', order = {raw_summary:{provider:'amazon_sp_api'}}) {
 if(!lines?.length)return null;
 let total=0;
 for(const line of lines){const amount=netSalesLineAmount(line,order);if(amount===null)return null;total+=amount;}
 return {amount:Math.round((total+Number.EPSILON)*100)/100,currency,basis:'net'};
}
export function orderDisplayAmount(order) {
 const net=numeric(order.net_revenue);
 if(net!==null)return {amount:net,note:'',basis:'net'};
 if(order.pricePreview?.basis==='net')return {amount:order.pricePreview.amount,note:'Solo prodotti · IVA esclusa · provvisorio',basis:'products'};
 return {amount:null,note:'Importo IVA esclusa non disponibile',basis:'unavailable'};
}
export function withOrderPreviews(orders,lines) {
 const byOrder=new Map();
 for(const line of lines){if(!byOrder.has(line.order_id))byOrder.set(line.order_id,[]);byOrder.get(line.order_id).push(line);}
 return orders.map(order=>({...order,pricePreview:amazonProductsPreview(byOrder.get(order.id),order.currency,order)||(order.pricePreview?.basis==='net'?order.pricePreview:null)}));
}
