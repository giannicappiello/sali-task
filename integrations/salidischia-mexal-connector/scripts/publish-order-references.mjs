import{readFile}from'node:fs/promises';
import{Journal}from'../src/journal.mjs';
import{wooClient}from'../src/clients.mjs';
import{prepareOrder}from'../src/order.mjs';
import{syncVerifiedOrderReference}from'../src/order-reference.mjs';
import{acquireRunLock}from'../src/run-lock.mjs';
const release=await acquireRunLock(),journal=new Journal('data/connector.sqlite');
try{
 const config=JSON.parse(await readFile('.private/connector-config.json','utf8')),woo=wooClient(process.env,undefined,{enableWrites:true});
 const records=journal.db.prepare("SELECT * FROM imports WHERE status='verified'").all();
 for(const record of records){
  const id=record.source_key.split('|').at(-1);if(!/^\d+$/.test(id))throw Error('ID di origine non valido.');
  const source=await woo.order(id),plan=prepareOrder(source,config);if(record.source_key!==plan.key)throw Error('Origine diversa dal connettore.');
  const result=await syncVerifiedOrderReference({source,plan,record,woo});console.log(JSON.stringify({orderId:id,documentRef:record.document_ref,result}));
 }
}finally{journal.close();await release();}
