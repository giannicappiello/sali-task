import test from 'node:test';
import assert from 'node:assert/strict';
import { trustedHrIp, hrNetworkRequest } from './hr-network.js';
const uid='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', key='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const req=()=>({method:'POST',headers:{authorization:'Bearer valid','x-vercel-forwarded-for':'8.8.8.8'},body:{action:'in',key}});
test('only the trusted Vercel ingress IP is accepted, never body or forwarded fallback',()=>{
  assert.equal(trustedHrIp(req(),true),'8.8.8.8');
  for(const value of [undefined,'8.8.8.8, 1.1.1.1',['8.8.8.8'],'invalid']) assert.throws(()=>trustedHrIp({headers:{'x-vercel-forwarded-for':value,'x-forwarded-for':'8.8.8.8'}},true));
  assert.throws(()=>trustedHrIp(req(),false));
});
test('server validates the token and overwrites client identity and IP before RPC',async()=>{
  let called;
  const client={auth:{getUser:async()=>({data:{user:{id:uid}}})},rpc:async(name,args)=>{called={name,args};return {data:{id:key}};}};
  const request=req();request.body.ip='1.1.1.1';request.body.user_id=key;
  await hrNetworkRequest(request,client,true);
  assert.equal(called.args.p_auth_user,uid);assert.equal(called.args.p_ip,'8.8.8.8');
  client.auth.getUser=async()=>({error:new Error('expired')});called=null;
  await assert.rejects(hrNetworkRequest(request,client,true),/Sessione/);assert.equal(called,null);
});
test('IP discovery is admin-only and does not mutate attendance',async()=>{
  let admin=false;
  const chain={select:()=>chain,eq:()=>chain,maybeSingle:async()=>({data:{attivo:true,ruoli:{amministratore_workspace:admin}}})};
  const client={auth:{getUser:async()=>({data:{user:{id:uid}}})},from:()=>chain,rpc:()=>{throw Error('unexpected write');}};
  const request={...req(),method:'GET'};
  await assert.rejects(hrNetworkRequest(request,client,true),/admin/);
  admin=true;assert.deepEqual(await hrNetworkRequest(request,client,true),{ip:'8.8.8.8'});
});
