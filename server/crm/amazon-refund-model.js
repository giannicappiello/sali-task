import crypto from 'node:crypto';
import {amazonOrderDate} from './amazon-cox.js';

export const refundHash=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail=message=>{throw new Error(message);};
const cents=money=>{
  if(money?.currencyCode!=='EUR' || !Number.isFinite(money.currencyAmount))fail('Importo rimborso Amazon in EUR non disponibile.');
  return Math.round(money.currencyAmount*100);
};
const identifier=(rows,name,key='relatedIdentifier')=>{
 const matches=(rows || []).filter(row=>row[key+'Name']===name).map(row=>row[key+'Value']);
 return matches.length===1?matches[0]:null;
};

// Persist the refund's own identity. Its order ID is shared with the sale and
// cannot identify a financial event or distinguish multiple partial refunds.
export function normalizeRefundTransaction(row,fromDate){
 if(row.transactionType!=='Refund')return null;
 const order=identifier(row.relatedIdentifiers,'ORDER_ID'),refundId=identifier(row.relatedIdentifiers,'REFUND_ID');
 if(!/^\d{3}-\d{7}-\d{7}$/.test(order || '') || !row.transactionId || !row.postedDate)fail('Rimborso Amazon senza identità o data verificabile.');
 if(amazonOrderDate(row.postedDate)<fromDate.replaceAll('-',''))return null;
 const eventKey=refundHash([order,refundId || row.transactionId]);
 const base={event_key:eventKey,amazon_order_id:order,posted_at:row.postedDate,marketplace:row.marketplaceId,currency:'EUR',financial_snapshot:row,source_status:row.transactionStatus};
 try{
  if(!refundId)fail('Rimborso senza REFUND_ID stabile: emissione da verificare.');
  if(!row.marketplaceId)fail('Marketplace rimborso non disponibile.');
  const saleRoots=(row.breakdowns || []).filter(b=>b.breakdownType==='Refunded Sales');
  if(saleRoots.length!==1)fail('Rimborso senza totale Refunded Sales distinto dalle commissioni.');
  const total=cents(saleRoots[0].breakdownAmount);
  if(total>=0)fail('Rimborso privo di importo negativo verso il cliente.');
  const allowedCharges=new Set(['ProductCharges','ShippingCharges','Shipping','GiftWrapCharges','GiftWrap','Promotions','Promotion','Discounts']);
  const fees=new Set(['AmazonFees','DigitalServicesFee','Expenses','Refunded Expenses']);
  const usedIds=new Set();
  const items=(row.items || []).map(item=>{
   const contexts=(item.contexts || []).filter(c=>c.contextType==='ProductContext');
   if(contexts.length!==1)fail('Identità prodotto del rimborso non univoca.');
   const product=contexts[0],quantity=Number(product.quantityShipped);
   const lineId=identifier(item.relatedIdentifiers,'ORDER_ADJUSTMENT_ITEM_ID','itemRelatedIdentifier');
   if(!product.sku || !lineId || usedIds.has(lineId) || !Number.isSafeInteger(quantity) || quantity<=0)fail('SKU, identificativo o quantità del rimborso non disponibili.');
   usedIds.add(lineId);
   let net=0,tax=0,hasPrincipal=false,hasTax=false;
   for(const b of item.breakdowns || []){
    if(b.breakdownType==='Tax'){tax+=cents(b.breakdownAmount);hasTax=true;}
    else if(allowedCharges.has(b.breakdownType)){net+=cents(b.breakdownAmount);hasPrincipal=true;}
    else if(!fees.has(b.breakdownType))fail('Componente finanziaria rimborso non riconosciuta: '+b.breakdownType);
   }
   if(!hasPrincipal || !hasTax || net>=0 || tax>0)fail('Imponibile/IVA del rimborso non riconciliati.');
   return {line_id:String(lineId),sku:String(product.sku),asin:product.asin || null,quantity,gross:-(net+tax)/100,net:-net/100,tax:-tax/100};
  }).sort((a,b)=>a.line_id.localeCompare(b.line_id));
  if(!items.length || items.reduce((sum,item)=>sum+Math.round(item.gross*100),0)!==-total)fail('Totale rimborso diverso dalla somma delle righe: nessun importo stimato.');
  const gross=-total/100,net=items.reduce((sum,item)=>sum+Math.round(item.net*100),0)/100,tax=items.reduce((sum,item)=>sum+Math.round(item.tax*100),0)/100;
  return {...base,gross,net,tax,items,financial_hash:refundHash([order,row.marketplaceId,items]),parse_error:null};
 }catch(error){return {...base,gross:null,net:null,tax:null,items:[],financial_hash:refundHash([order,refundId || row.transactionId,'unparsed']),parse_error:String(error.message).slice(0,500)};}
}

export function normalizePhysicalReturns(rows){
 const result=new Map();
 for(const row of rows){
  const order=row['order-id'],sku=row.sku,quantity=Number(row.quantity),date=row['return-date'];
  if(!/^\d{3}-\d{7}-\d{7}$/.test(order || '') || !sku || !Number.isSafeInteger(quantity) || quantity<=0 || !Number.isFinite(Date.parse(date)))fail('Riga reso fisico Amazon non valida.');
  const key=refundHash([order,sku,row['license-plate-number'] || date]);
  const normalized={return_key:key,amazon_order_id:order,sku,quantity,returned_at:date,disposition:row['detailed-disposition'],status:row.status};
  const previous=result.get(key);
  if(previous && JSON.stringify(previous)!==JSON.stringify(normalized))fail('Stato reso Amazon ambiguo per lo stesso riferimento fisico.');
  result.set(key,normalized);
 }
 return [...result.values()];
}

// Each confirmed physical unit is allocated only once across this order's
// refund events, including multiple refunds for the same SKU.
export function refundDispositions(refund,events,returns){
 const capacity=new Map();
 for(const row of returns)if(row.disposition==='SELLABLE' && row.status==='Unit returned to inventory')capacity.set(row.sku,(capacity.get(row.sku)||0)+Number(row.quantity));
 const used=new Map(),result=new Map();
 const sorted=[...events].sort((a,b)=>a.posted_at.localeCompare(b.posted_at)||a.event_key.localeCompare(b.event_key));
 for(const event of sorted)for(const item of event.items || []){
  const offset=used.get(item.sku)||0,quantity=Math.max(0,Math.min(item.quantity,(capacity.get(item.sku)||0)-offset));
  used.set(item.sku,offset+item.quantity);
  if(event.event_key===refund.event_key)result.set(item.line_id,{sellableQuantity:quantity,confirmed:quantity>0,disposition:quantity>0?'SELLABLE':'UNCONFIRMED_OR_UNSELLABLE'});
 }
 return result;
}

export function italianRefundStart(date){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date || ''))fail('Configurare la data iniziale dei rimborsi Amazon.');
 const midnight=Date.parse(date+'T00:00:00Z');
 const offset=new Intl.DateTimeFormat('en',{timeZone:'Europe/Rome',timeZoneName:'shortOffset'}).formatToParts(new Date(midnight)).find(p=>p.type==='timeZoneName').value;
 const hours=Number(offset.replace('GMT',''));
 if(!Number.isFinite(hours))fail('Fuso orario rimborso non verificato.');
 return new Date(midnight-hours*3600000).toISOString();
}
