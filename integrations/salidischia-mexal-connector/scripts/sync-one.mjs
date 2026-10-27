import{readFile,writeFile,mkdir}from'node:fs/promises';
import{wooClient,mexalTransport}from'../src/clients.mjs';import{MexalAdapter}from'../src/adapter.mjs';
import{prepareOrder}from'../src/order.mjs';import{Journal}from'../src/journal.mjs';import{syncOrder}from'../src/sync.mjs';
import{syncVerifiedOrderReference}from'../src/order-reference.mjs';import{publishOrderStatus}from'../src/order-status.mjs';import{acquireRunLock}from'../src/run-lock.mjs';
const id=process.argv[2],dryRun=!process.argv.includes('--write');
if(!/^[1-9]\d*$/.test(id||''))throw Error('Specificare un solo ID ordine positivo.');
let release,journal;
try{
 release=await acquireRunLock();const config=JSON.parse(await readFile('.private/connector-config.json','utf8'));
 const woo=wooClient(process.env,undefined,{enableWrites:!dryRun}),source=await woo.order(id),plan=prepareOrder(source,config);
 if(Number(id)<=config.legacyReconciledThrough||plan.date<config.importFrom)throw Error('Ordine precedente al subentro: invio mirato bloccato.');
 if(!dryRun){const status=await woo.connectorStatus();if(!config.cutoverVerified||!config.contractVerified||status.partition_active!==true||status.last_legacy_order_id!==config.legacyReconciledThrough||status.authenticated_key_id!==status.connector_key_id)throw Error('Separazione connettore non verificata.');}
 journal=new Journal('data/connector.sqlite');const mexal=new MexalAdapter(mexalTransport(process.env,undefined,{enableWrites:!dryRun}),config);
 const result=await syncOrder(plan,{journal,mexal,config,dryRun}),row={at:new Date().toISOString(),orderId:id,mode:result.mode,documentRef:result.documentRef||null};
 if(!dryRun){
  const record=journal.get(plan.key);row.crmReference=await syncVerifiedOrderReference({source,plan,record,woo});
  let catalogAt=null;try{catalogAt=JSON.parse(await readFile('output/catalog-last-run.json','utf8')).at;}catch{}
  row.crmStatus=await publishOrderStatus({source,result,record,woo,catalogAt});
  row.amountComparison=record.verification_json?JSON.parse(record.verification_json):null;
 }
 await mkdir('output',{recursive:true});await writeFile(`output/order-${id}-sync.json`,JSON.stringify(row,null,2));console.log(JSON.stringify(row));
}catch(error){console.error(error.message);process.exitCode=1;}finally{journal?.close();await release?.();}
