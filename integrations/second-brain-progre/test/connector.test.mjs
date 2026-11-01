import test from 'node:test';
import assert from 'node:assert/strict';
import { createBridge, serve } from '../src/server.mjs';
import { createClient, validateConfig } from '../src/client.mjs';
import { startInteraction } from '../src/interactive.mjs';
import { PassThrough } from 'node:stream';

const config={workspaceUrl:'https://workspace.progre.it',supabaseUrl:'https://example.supabase.co',supabaseAnonKey:'sb_publishable_example_public_key'};
test('rejects non-corporate origins, credentials in URLs and privileged keys',()=>{
  for(const change of [{workspaceUrl:'http://workspace.progre.it'},{workspaceUrl:'https://workspace.progre.it.evil.test'},{supabaseUrl:'https://evil.test'},{supabaseAnonKey:'sb_secret_never_use_this'}]) assert.throws(()=>validateConfig({...config,...change}));
});
test('connector never accepts a model-supplied direct confirmation operation',async()=>{
  const sent=[];
  const bridge=createBridge({request:async body=>{sent.push(body);return {tools:[{name:'READ',inputSchema:{}}]};}});
  await assert.rejects(bridge.call('decide',{decision:'confirm'}),/non disponibile/);
  assert.deepEqual(sent,[{action:'catalog'}]);
});
test('opening review only starts a human interaction, not a backend decision',async()=>{
  const sent=[];
  const bridge=createBridge({request:async body=>{sent.push(body);}},async()=>({url:'http://127.0.0.1:1234/test',getStatus:()=>({status:'waiting'}),close(){}}));
  assert.equal((await bridge.call('BRAIN_REVIEW',{kind:'brain',id:'11111111-1111-4111-8111-111111111111'})).requiresHuman,true);
  assert.equal(sent.length,0); bridge.close();
});
test('session is not saved if Workspace denies access; credentials never reach model endpoints',async()=>{
  const urls=[];let saved=false;
  const client=createClient(config,{save:()=>{saved=true;},withLock:fn=>fn()},async(url)=>{
    urls.push(url);
    return url.includes('/auth/v1/token')?Response.json({access_token:'a',refresh_token:'b',expires_in:3600,user:{id:'one'}}):Response.json({success:false,error:'forbidden'},{status:403});
  });
  await assert.rejects(client.login('one@example.test','test-password'),/forbidden/);
  assert.equal(saved,false);assert(urls.every(url=>!url.includes('openai.com')));
});
test('local login rejects cross-origin submissions and emits an escaped form',async()=>{
  let calls=0;
  const local=await startInteraction({type:'login',client:{login:async()=>{calls++;}},ttlMs:10000});
  try{
    const page=await fetch(local.url); assert.equal(page.status,200);assert.equal(page.headers.get('cache-control'),'no-store');
    assert.equal(page.headers.get('referrer-policy'),'same-origin');
    const response=await fetch(local.url,{method:'POST',headers:{origin:'https://evil.test','Content-Type':'application/x-www-form-urlencoded'},body:'email=a&password=b'});
    assert.equal(response.status,403);assert.equal(calls,0);
    const opaque=await fetch(local.url,{method:'POST',headers:{origin:'null','Content-Type':'application/x-www-form-urlencoded'},body:'email=a&password=b'});
    assert.equal(opaque.status,403);assert.equal(calls,0);
    const accepted=await fetch(local.url,{method:'POST',headers:{origin:new URL(local.url).origin,'Content-Type':'application/x-www-form-urlencoded'},body:'email=a&password=b'});
    assert.equal(accepted.status,200);assert.equal(calls,1);
  }finally{local.close();}
});
test('MCP initialize and tools/list work without a saved login; stdout contains JSON only',async()=>{
  const input=new PassThrough(),output=new PassThrough();let lines='';output.on('data',c=>{lines+=c;});
  serve(createBridge({request:async()=>{throw new Error('login required');}}),input,output);
  input.write(JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-03-26'}})+'\n');
  input.write(JSON.stringify({jsonrpc:'2.0',id:2,method:'tools/list'})+'\n');
  await new Promise(resolve=>setTimeout(resolve,30));input.end();
  const rows=lines.trim().split('\n').map(JSON.parse);
  assert.equal(rows[0].result.serverInfo.name,'second-brain-progre');
  assert(rows[1].result.tools.some(t=>t.name==='BRAIN_LOGIN'));
});
