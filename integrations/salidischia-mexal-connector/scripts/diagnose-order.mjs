import {readFile,writeFile} from 'node:fs/promises';
import {mexalTransport,wooClient} from '../src/clients.mjs';
import {MexalAdapter} from '../src/adapter.mjs';
import {prepareOrder} from '../src/order.mjs';
const id=process.argv[2];if(!/^\d+$/.test(id||''))throw Error('ID non valido');
const config=JSON.parse(await readFile('.private/connector-config.json','utf8'));
const order=await wooClient().order(id);await writeFile(`data/ordine-${id}.json`,JSON.stringify(order,null,2));
const plan=prepareOrder(order,config),api=mexalTransport();let phase='findExistingOrder';
const trace=[];const probe={...api,request:async(path,options={})=>{if(options.method&&options.method!=='GET'){await writeFile(`.private/order-${id}-planned-write.json`,JSON.stringify({phase,path,...options},null,2));throw Error('Scrittura diagnostica intercettata: nessuna modifica eseguita.');}return api.request(path,options);}};
const adapter=new MexalAdapter(probe,config);
try{
 const existing=await adapter.findExistingOrder(plan);trace.push({phase,found:Boolean(existing)});if(existing)throw Error('Riferimento ordine già presente.');
 phase='preflight';await adapter.preflight(plan,config);trace.push({phase,verified:true});
 phase='ensureCustomer';const code=await adapter.ensureCustomer(plan.customer);trace.push({phase,code});
}catch(error){trace.push({phase,message:error.message});}
await writeFile(`.private/order-${id}-diagnosis.json`,JSON.stringify({plan,trace},null,2));
console.log(JSON.stringify({orderId:id,trace}));
