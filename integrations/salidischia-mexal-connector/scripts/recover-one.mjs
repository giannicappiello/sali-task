import {readFile,writeFile} from 'node:fs/promises';
import {wooClient,mexalTransport} from '../src/clients.mjs';
import {MexalAdapter} from '../src/adapter.mjs';
import {prepareOrder} from '../src/order.mjs';
import {Journal} from '../src/journal.mjs';
import {resumeOrder} from '../src/sync.mjs';
import {syncVerifiedOrderReference} from '../src/order-reference.mjs';
import {publishOrderStatus} from '../src/order-status.mjs';
import {acquireRunLock} from '../src/run-lock.mjs';
const id=process.argv[2];
if(!/^[1-9]\d*$/.test(id||'')||!process.argv.includes('--write'))throw Error('Recupero esplicito: specificare un solo ID e --write.');
const release=await acquireRunLock();let journal;
try{
 const config=JSON.parse(await readFile('.private/connector-config.json','utf8'));
 const woo=wooClient(process.env,undefined,{enableWrites:true}),source=await woo.order(id),plan=prepareOrder(source,config);
 const status=await woo.connectorStatus();
 if(!config.cutoverVerified||!config.contractVerified||Number(id)<=config.legacyReconciledThrough||plan.date<config.importFrom||status.partition_active!==true||status.last_legacy_order_id!==config.legacyReconciledThrough||status.authenticated_key_id!==status.connector_key_id)throw Error('Separazione connettore non verificata.');
 journal=new Journal('data/connector.sqlite');const entry=journal.get(plan.key);
 if(entry?.status!=='reconciliation_required'||entry.plan_hash!==plan.hash||entry.document_ref)throw Error('Stato recupero non valido.');
 journal.db.exec(`VACUUM INTO '.private/journal-before-recovery-${id}-${Date.now()}.sqlite'`);
 const mexal=new MexalAdapter(mexalTransport(process.env,undefined,{enableWrites:true}),config);
 if(await mexal.findExistingOrder(plan))throw Error('OC già presente: nessun reinvio consentito.');
 await mexal.preflight(plan,config);
 if(!entry.customer_code){
  const override=config.customerAlternateOverrides?.[plan.customer.externalId];
  const fiscalRejected=entry.last_phase==='customer_pending'&&/Mexal 6001, campo codice_fiscale/.test(entry.last_error||'');
  const knownLink=entry.last_phase==='customer_pending'&&/Codice alternativo cliente/.test(entry.last_error||'')&&override?.customerCode;
  if(!fiscalRejected&&!knownLink)throw Error('Cliente incerto: riconciliazione specifica richiesta.');
  try{
   journal.set(plan.key,'customer_pending');
   const code=await mexal.ensureCustomer(plan.customer,knownLink?{expectedCode:override.customerCode}:{});
   journal.set(plan.key,'customer_pending',code);await mexal.verifyCustomer(code,plan.customer);
   journal.set(plan.key,'reconciliation_required',code);
  }catch(error){journal.fail(plan.key,error);throw error;}
 }
 const result=await resumeOrder(plan,{journal,mexal,config});const record=journal.get(plan.key);
 const crmReference=await syncVerifiedOrderReference({source,plan,record,woo});
 let catalogAt=null;try{catalogAt=JSON.parse(await readFile('output/catalog-last-run.json','utf8')).at;}catch{}
 const crmStatus=await publishOrderStatus({source,result,record,woo,catalogAt});
 const report={at:new Date().toISOString(),orderId:id,...result,crmReference,crmStatus,amountComparison:JSON.parse(record.verification_json||'null')};
 await writeFile(`output/order-${id}-recovered.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}catch(error){await writeFile(`.private/recovery-${id}-last-error.json`,JSON.stringify({message:error.message,status:error.status,details:error.apiDetails},null,2));console.error(error.message);process.exitCode=1;}
finally{journal?.close();await release();}
