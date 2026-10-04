import test from 'node:test';
import assert from 'node:assert/strict';
import { attendanceRpcFetch } from '../src/modules/hr/hrObservationTransport.js';
test('first outside observation is dispatched with keepalive and unchanged authorization and GPS payload',async()=>{
  const body=JSON.stringify({p_action:'observe',p_position:{latitude:40.01,longitude:14,accuracy:12}});
  const init={method:'POST',headers:{Authorization:'Bearer test'},body};
  let sent;
  await attendanceRpcFetch('https://example.invalid/rest/v1/rpc/workspace_hr_punch',init,async(input,options)=>{sent={input,options};return {ok:true};});
  assert.equal(sent.options.keepalive,true); assert.equal(sent.options.body,body); assert.equal(sent.options.headers,init.headers);
});
test('other requests and manual punches preserve the existing transport',async()=>{
  for(const [url,body] of [['workspace_hr_location_punch',{p_action:'in'}],['workspace_hr_location_punch',{p_action:'out'}],['unrelated',{p_action:'observe'}],['workspace_hr_punch',{}]]) {
    const init={method:'POST',body:JSON.stringify(body)};
    await attendanceRpcFetch('https://example.invalid/rest/v1/rpc/'+url,init,async(_input,options)=>{assert.equal(options,init);});
  }
});
