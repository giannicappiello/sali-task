import {gunzipSync} from 'node:zlib';
import {request,refreshAccessToken} from './digital-provider-adapters.js';
import {safeFetch} from './digital-security.js';

async function amazonClient(connection,secrets,fetcher) {
  const root={eu:'https://sellingpartnerapi-eu.amazon.com',na:'https://sellingpartnerapi-na.amazon.com',fe:'https://sellingpartnerapi-fe.amazon.com'}[connection.configurazione?.region || 'eu'];
  if(!root)throw new Error('Regione Amazon non valida.');
  const token=await refreshAccessToken(connection,secrets,fetcher);
  return (path,options={})=>request(root+path,{headers:{'x-amz-access-token':token.access_token,accept:'application/json','content-type':'application/json'},timeoutMs:20000,maxBytes:2097152,...options},fetcher,'Resi Amazon');
}

const money=value=>value && {currencyAmount:value.currencyAmount,currencyCode:value.currencyCode};
const breakdowns=(rows=[],depth=0)=>{
  if(!Array.isArray(rows) || rows.length>100 || depth>8)throw new Error('Dettaglio finanziario Amazon troppo esteso o non valido.');
  return rows.map(row=>({breakdownType:row.breakdownType,breakdownAmount:money(row.breakdownAmount),breakdowns:breakdowns(row.breakdowns,depth+1)}));
};
export function safeFinancialTransaction(row) {
  return {transactionId:row.transactionId,transactionType:row.transactionType,transactionStatus:row.transactionStatus,postedDate:row.postedDate,
    relatedIdentifiers:(row.relatedIdentifiers || []).map(({relatedIdentifierName,relatedIdentifierValue})=>({relatedIdentifierName,relatedIdentifierValue})),
    marketplaceId:row.marketplaceDetails?.marketplaceId || row.sellingPartnerMetadata?.marketplaceId,
    totalAmount:money(row.totalAmount),breakdowns:breakdowns(row.breakdowns),items:(row.items || []).map(item=>({
      relatedIdentifiers:(item.relatedIdentifiers || []).map(({itemRelatedIdentifierName,itemRelatedIdentifierValue})=>({itemRelatedIdentifierName,itemRelatedIdentifierValue})),
      totalAmount:money(item.totalAmount),breakdowns:breakdowns(item.breakdowns),contexts:(item.contexts || []).filter(c=>c.contextType==='ProductContext').map(c=>({contextType:c.contextType,sku:c.sku,asin:c.asin,quantityShipped:c.quantityShipped}))}))};
}

export async function financialTransactions(connection,secrets,{orderId,from,to,nextToken,fetcher=safeFetch}={}) {
  const call=await amazonClient(connection,secrets,fetcher),query=new URLSearchParams();
  if(orderId){if(!/^\d{3}-\d{7}-\d{7}$/.test(orderId))throw new Error('Ordine Amazon non valido.');query.set('relatedIdentifierName','ORDER_ID');query.set('relatedIdentifierValue',orderId);}
  else {query.set('postedAfter',from);query.set('postedBefore',to);}
  if(nextToken)query.set('nextToken',nextToken);
  const data=await call('/finances/2024-06-19/transactions?'+query);
  if(!Array.isArray(data.payload?.transactions))throw new Error('Movimenti finanziari Amazon incompleti.');
  return {transactions:data.payload.transactions.map(safeFinancialTransaction),nextToken:data.payload.nextToken || null};
}

export function returnReportRows(input) {
  const records=[];let row=[],cell='',quoted=false;
  const text=String(input).replace(/^\uFEFF/,'');
  for(let i=0;i<=text.length;i++) {
    const c=text[i] || '\n';
    if(c==='"'){if(quoted && text[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;}
    else if(!quoted && (c==='\t'||c==='\n')){row.push(cell.replace(/\r$/,''));cell='';if(c==='\n'){if(row.some(Boolean))records.push(row);row=[];}}
    else cell+=c;
  }
  if(quoted)throw new Error('Report resi Amazon incompleto.');
  const header=records.shift() || [];
  for(const key of ['return-date','order-id','sku','quantity','detailed-disposition','status'])if(!header.includes(key))throw new Error('Report resi senza campo '+key);
  return records.map(row=>Object.fromEntries(['return-date','order-id','sku','asin','quantity','detailed-disposition','status','license-plate-number'].map(key=>[key,row[header.indexOf(key)] || ''])));
}

export async function fbaReturnReport(connection,secrets,{reportId,from,to,fetcher=safeFetch}={}) {
  const call=await amazonClient(connection,secrets,fetcher);
  if(!reportId){const result=await call('/reports/2021-06-30/reports',{method:'POST',body:JSON.stringify({reportType:'GET_FBA_FULFILLMENT_CUSTOMER_RETURNS_DATA',dataStartTime:from,dataEndTime:to,marketplaceIds:connection.marketplace_ids})});if(!result.reportId)throw new Error('Report resi non creato.');return {reportId:result.reportId,status:'IN_QUEUE'};}
  if(!/^\d{1,60}$/.test(reportId))throw new Error('Riferimento report non valido.');
  const result=await call('/reports/2021-06-30/reports/'+reportId);
  if(result.processingStatus!=='DONE')return {reportId,status:result.processingStatus};
  const doc=await call('/reports/2021-06-30/documents/'+encodeURIComponent(result.reportDocumentId));
  if(!doc.url || ![undefined,'GZIP'].includes(doc.compressionAlgorithm))throw new Error('Formato report resi non supportato.');
  const response=await fetcher(doc.url,{binary:true,timeoutMs:20000,maxBytes:2097152});
  if(!response.ok)throw new Error('Download report resi non riuscito.');
  const content=doc.compressionAlgorithm==='GZIP'?gunzipSync(response.data,{maxOutputLength:20971520}).toString('utf8'):String(response.data);
  return {reportId,status:'DONE',rows:returnReportRows(content)};
}
