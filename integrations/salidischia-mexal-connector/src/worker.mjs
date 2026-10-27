import{prepareOrder}from'./order.mjs';
import{syncOrder}from'./sync.mjs';
import{syncVerifiedOrderReference}from'./order-reference.mjs';
import{publishOrderStatus}from'./order-status.mjs';
export async function runBatch({woo,mexal,journal,config,dryRun=true,onResult=()=>{}}){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(config.importFrom||''))throw new Error('Data di subentro obbligatoria.');
 if(!Number.isSafeInteger(config.legacyReconciledThrough)||config.legacyReconciledThrough<0)throw new Error('Ultimo ordine del vecchio flusso obbligatorio.');
 if(!dryRun&&(!config.cutoverVerified||!config.contractVerified))throw new Error('Passaggio dal vecchio connettore non verificato.');
 const orders=new Map();
 for(const status of['processing','completed']){
  const tokens=new Set();
  for(let page=1;page<=(config.maxWooPages||100);page++){
   const rows=await woo.orders({status,page,after:config.importFrom+'T00:00:00'});
   if(!Array.isArray(rows))throw new Error('Elenco ordini WooCommerce non valido.');
   if(!rows.length)break;
   const signature=rows.map(x=>x.id).join(',');if(tokens.has(signature))throw new Error('Paginazione WooCommerce ripetuta.');tokens.add(signature);
   for(const order of rows)if(Number(order.id)>config.legacyReconciledThrough)orders.set(String(order.id),order);
   if(rows.length<100)break;
   if(page===(config.maxWooPages||100))throw new Error('Elenco WooCommerce incompleto: limite pagine raggiunto.');
  }
 }
 const results=[];
 for(const source of [...orders.values()].sort((a,b)=>Number(a.id)-Number(b.id))){
  let plan;
  async function publishStatus(row,error){
   if(dryRun||!config.publishSyncStatus)return;
   try{row.crmStatus=await publishOrderStatus({source,result:row,record:plan?journal.get(plan.key):null,error,woo,catalogAt:config.catalogLastSuccessAt||null});}
   catch(statusError){row.crmStatus='pending';row.statusError=statusError.message;}
  }
  try{
   plan=prepareOrder(source,config);
   const result=await syncOrder(plan,{mexal,journal,config,dryRun});
   const row={orderId:plan.orderId,mode:result.mode,documentRef:result.documentRef||null};
   if(!dryRun&&config.publishOrderReferences&&['imported','already-imported'].includes(result.mode)){
    try{row.crmReference=await syncVerifiedOrderReference({source,plan,record:journal.get(plan.key),woo});}
    catch(error){row.crmReference='pending';row.referenceError=error.message;}
   }
   await publishStatus(row);results.push(row);onResult(row);
  }catch(error){const row={orderId:String(source.id),mode:'attention-required',message:error.message};await publishStatus(row,error);results.push(row);onResult(row);}
 }
 return{dryRun,processed:results.length,results};
}
