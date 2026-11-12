import test from 'node:test';
import assert from 'node:assert/strict';
import process from 'node:process';
import {commercialReportTools} from '../second-brain/commercial-report-tools.js';
import {workerReady} from './commercial-service.js';
import {handleCommercialReports} from './commercial-handler.js';

const adminProfile={id:'owner',ruoli:{amministratore_workspace:true}};
test('commercial tools never appear for other users or disabled internal data',()=>{
  assert.deepEqual(commercialReportTools({profile:{ruoli:{}},capabilities:{internal_data:true}}),{});
  assert.deepEqual(commercialReportTools({profile:adminProfile,capabilities:{internal_data:false}}),{});
});
test('PH uses ordered RPC and Professional uses purchased RPC with complete pagination',async()=>{
  const calls=[];
  const auth={profile:adminProfile,capabilities:{internal_data:true},scoped:{rpc:async(name,args)=>{calls.push({name,args});return {data:Array.from({length:51},(_,i)=>({id:i})),error:null};}}};
  const tools=commercialReportTools(auth);
  const ph=await tools.COMMERCIAL_REPORT_DATA.execute({agentCode:'602.00069',from:'2026-10-01',to:'2026-10-31',kind:'products',offset:50});
  assert.equal(ph.rows.length,50);assert.equal(ph.nextOffset,100);assert.equal(ph.source,'ordiniph');
  assert.equal(calls[0].args.p_order_module,'ph');assert.equal(calls[0].args.p_category,'ordered');
  await tools.COMMERCIAL_REPORT_DATA.execute({agentCode:'602.00013',from:'2026-10-01',to:'2026-10-31',kind:'lines',productCode:'IT0039'});
  assert.equal(calls[1].args.p_order_module,'prof');assert.equal(calls[1].args.p_category,'purchased');assert.equal(calls[1].args.p_customer_group,'regular');
  await assert.rejects(()=>tools.COMMERCIAL_REPORT_DATA.execute({agentCode:'602.00013',from:'2026-10-01',to:'2026-10-31',kind:'lines'}),/codice prodotto/);
});
test('worker capability check never asks the order service to send anything',async()=>{
  const oldUrl=process.env.ARUBA_EMAIL_WORKER_URL,oldSecret=process.env.ARUBA_EMAIL_WORKER_SECRET;
  process.env.ARUBA_EMAIL_WORKER_URL='https://example.test/worker.php';process.env.ARUBA_EMAIL_WORKER_SECRET='test-not-a-real-secret';
  try {
    const result=await workerReady(async(url,options)=>{
      assert.equal(url,'https://example.test/worker.php?action=report_capabilities');
      assert.equal(options.method,'GET');assert.equal(options.body,undefined);
      return {ok:true,json:async()=>({report_protocol:1,report_recipient_lists:true,queue_enabled:true,from_email:'orders@example.test'})};
    });
    assert.equal(result.ready,true);
    await assert.rejects(()=>workerReady(async()=>({ok:true,json:async()=>({status:'idle'})})),/elenchi destinatari/);
    await assert.rejects(()=>workerReady(async(_url,options)=>{assert.equal(options.method,'GET');return {ok:true,json:async()=>({report_protocol:1,queue_enabled:true})};}),/elenchi destinatari/);
  }finally{if(oldUrl===undefined)delete process.env.ARUBA_EMAIL_WORKER_URL;else process.env.ARUBA_EMAIL_WORKER_URL=oldUrl;if(oldSecret===undefined)delete process.env.ARUBA_EMAIL_WORKER_SECRET;else process.env.ARUBA_EMAIL_WORKER_SECRET=oldSecret;}
});
test('configuration rejects non-admin requests and missing cron credentials before DB access',async()=>{
  const res={statusCode:200,status(n){this.statusCode=n;return this;},json(body){this.body=body;return this;}};
  await handleCommercialReports({method:'GET',headers:{},query:{}},res,{authorize:async()=>({profile:{ruoli:{}}})});
  assert.equal(res.statusCode,403);
  await handleCommercialReports({method:'GET',headers:{authorization:'Bearer wrong'},query:{cron:'1'}},res,{admin:()=>{throw new Error('must not create DB client');}});
  assert.equal(res.statusCode,401);
});
