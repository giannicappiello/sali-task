/* global process, Buffer */
import test from 'node:test';
import assert from 'node:assert/strict';
import {validRedirect,redirectMatches,clientMetadata,authorizationInput,challenge,seal,unseal,exchangeToken,grantConnection,RESOURCE} from './online-auth.js';

test('redirects accept official OpenAI and bound loopback callbacks only',()=>{
 for(const uri of ['https://evil.test/callback','http://localhost.evil.test/callback','http://127.0.0.1/other','http://name:pass@127.0.0.1/callback','http://127.0.0.1/callback?redirect=https://evil.test','file:///callback','https://chatgpt.com.evil.test/connector_platform_oauth_redirect'])assert.equal(validRedirect(uri),false);
 assert(redirectMatches('http://127.0.0.1/callback','http://127.0.0.1:49152/callback'));
 assert(!redirectMatches('http://127.0.0.1/callback','http://localhost:49152/callback'));
 assert(!redirectMatches('http://127.0.0.1/callback','http://127.0.0.1:49152/callback/other'));
});
test('client identity metadata cannot turn into arbitrary server-side fetching',async()=>{
 let fetched=false;await assert.rejects(clientMetadata('http://127.0.0.1/internal',()=>{fetched=true;}));assert.equal(fetched,false);
 const id='https://chatgpt.com/oauth/codex/client.json';
 await clientMetadata(id,async url=>{assert.equal(url,id);return Response.json({client_id:id,redirect_uris:['http://127.0.0.1/callback','http://localhost/callback']});});
});
test('authorization requires S256 PKCE, exact resource, allowed scope and registered redirect',async()=>{
 const input={response_type:'code',client_id:'https://chatgpt.com/oauth/codex/client.json',redirect_uri:'http://127.0.0.1:49152/callback',state:'fixture-state',code_challenge:challenge('v'.repeat(64)),code_challenge_method:'S256',resource:RESOURCE,scope:'second_brain offline_access'};
 assert.equal((await authorizationInput(input)).resource,RESOURCE);
 for(const patch of [{resource:'https://other.test/mcp'},{code_challenge_method:'plain'},{redirect_uri:'https://evil.test/callback'},{scope:'admin'},{response_type:'token'}])await assert.rejects(authorizationInput({...input,...patch}));
});
test('server sessions are encrypted and bound to user, connection and client',()=>{
 const previous=process.env.SUPABASE_SERVICE_ROLE_KEY;process.env.SUPABASE_SERVICE_ROLE_KEY='fixture-only-not-a-production-key';
 try{const encrypted=seal({accessToken:'fixture-token'},'user-a|connection-a|client-a');assert(!encrypted.includes('fixture-token'));assert.equal(unseal(encrypted,'user-a|connection-a|client-a').accessToken,'fixture-token');assert.throws(()=>unseal(encrypted,'user-b|connection-a|client-a'));assert.throws(()=>unseal(encrypted.slice(0,-6)+'xxxxxx','user-a|connection-a|client-a'));}
 finally{if(previous===undefined)delete process.env.SUPABASE_SERVICE_ROLE_KEY;else process.env.SUPABASE_SERVICE_ROLE_KEY=previous;}
});
test('token exchange delegates code consumption and token rotation to a single transaction',async()=>{
 let input;const admin={rpc:async(name,args)=>{assert.equal(name,'second_brain_exchange_oauth');input=args;return {data:'connection'};}};
 const verifier='v'.repeat(64);const response=await exchangeToken({grant_type:'authorization_code',client_id:'https://chatgpt.com/oauth/codex/client.json',resource:RESOURCE,redirect_uri:'http://127.0.0.1:49152/callback',code:'fixture-code',code_verifier:verifier},admin);
 assert.equal(response.expires_in,900);assert.equal(response.access_token.length,43);assert.equal(input.p_challenge,challenge(verifier));assert.notEqual(input.p_access_hash,response.access_token);
 await assert.rejects(exchangeToken({grant_type:'refresh_token',client_id:'https://chatgpt.com/oauth/codex/client.json',resource:'https://evil.test',refresh_token:'fixture'},admin));
});

test('connection accepts opaque Supabase refresh tokens without assuming their length',async()=>{
 const previous=process.env.SUPABASE_SERVICE_ROLE_KEY;process.env.SUPABASE_SERVICE_ROLE_KEY='fixture-only';
 const saved=[];
 const auth={profile:{id:'fixture-owner'},token:'header.'+Buffer.from(JSON.stringify({sub:'fixture-user',exp:2000000000})).toString('base64url')+'.signature',admin:{from:table=>({insert:async value=>{saved.push({table,value});return {data:null};}})}};
 const input={response_type:'code',client_id:'https://chatgpt.com/oauth/codex/client.json',redirect_uri:'http://127.0.0.1:49152/callback',state:'fixture-state',code_challenge:challenge('v'.repeat(64)),code_challenge_method:'S256',resource:RESOURCE};
 try{
  const target=new URL(await grantConnection(auth,input,'fixture12345'));
  assert(target.searchParams.get('code'));assert.equal(saved.length,2);
  const row=saved[0].value;
  assert.equal(unseal(row.session_sealed,row.id+'|fixture-owner|'+input.client_id).refreshToken,'fixture12345');
  await assert.rejects(grantConnection(auth,input,''));assert.equal(saved.length,2);
 }finally{if(previous===undefined)delete process.env.SUPABASE_SERVICE_ROLE_KEY;else process.env.SUPABASE_SERVICE_ROLE_KEY=previous;}
});
