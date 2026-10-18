import test from 'node:test';
import assert from 'node:assert/strict';
import process from 'node:process';
import { createHmac } from 'node:crypto';
import { handleClubMedia } from './club-media.js';
import proxy from '../apps/salidischia-club/api/club-media.js';
const id='10000000-0000-4000-8000-000000000701';
const response=()=>({statusCode:200,headers:{},status(value){this.statusCode=value;return this;},setHeader(key,value){this.headers[key]=value;},json(value){this.body=value;return this;}});
test('Club material gateway derives viewer from verified JWT and signs only authorized document IDs',async()=>{
 const original={url:process.env.DOCUMENT_GATEWAY_URL,secret:process.env.DOCUMENT_GATEWAY_SECRET};process.env.DOCUMENT_GATEWAY_URL='https://media.example.test';process.env.DOCUMENT_GATEWAY_SECRET='isolated-test-secret';
 const calls=[];const admin={auth:{getUser:async token=>token==='valid-token'?{data:{user:{id:'verified-user'}}}:{error:Error('Invalid')}},rpc:async(name,args)=>{calls.push({name,args});return {data:{[id]:'Cataloghi/scheda tecnica.pdf'}};}};
 try {
  let res=response();await handleClubMedia({body:{ids:[id,id],viewer_auth_id:'forged'},headers:{authorization:'Bearer valid-token'}},res,admin);assert.equal(res.statusCode,200);assert.deepEqual(calls[0],{name:'club_media_paths',args:{document_ids:[id],viewer_auth_id:'verified-user'}});assert.equal(res.headers['Cache-Control'],'private, no-store');
  const url=new URL(res.body.urls[id]);const expires=Number(url.searchParams.get('expires'));assert.ok(expires> Date.now()/1000+880 && expires<=Date.now()/1000+900);assert.equal(url.searchParams.get('signature'),createHmac('sha256','isolated-test-secret').update(url.pathname+'\n'+expires).digest('hex'));
  res=response();await handleClubMedia({body:{ids:[id],viewer_auth_id:'forged'},headers:{}},res,admin);assert.equal(calls.at(-1).args.viewer_auth_id,null);
  res=response();await handleClubMedia({body:{ids:[id]},headers:{authorization:'Bearer invalid'}},res,admin);assert.equal(res.statusCode,401);assert.equal(calls.length,2);
  res=response();await handleClubMedia({body:{ids:['../../private']},headers:{}},res,admin);assert.equal(res.statusCode,400);
  admin.rpc=async()=>({data:{}});res=response();await handleClubMedia({body:{ids:[id]},headers:{}},res,admin);assert.deepEqual(res.body.urls,{});
 } finally {if(original.url===undefined)delete process.env.DOCUMENT_GATEWAY_URL;else process.env.DOCUMENT_GATEWAY_URL=original.url;if(original.secret===undefined)delete process.env.DOCUMENT_GATEWAY_SECRET;else process.env.DOCUMENT_GATEWAY_SECRET=original.secret;}
});
test('Club same-origin media bridge has a fixed Workspace destination and validates bounded IDs',async()=>{
 const original=globalThis.fetch;let call;
 globalThis.fetch=async(url,options)=>{call={url,options};return {status:200,json:async()=>({urls:{}})};};
 try {
  const res=response();await proxy({method:'POST',headers:{authorization:'Bearer public-session'},body:{document_ids:[id],url:'https://forged.test',viewer_auth_id:'forged'}},res);assert.equal(call.url,'https://workspace.progre.it/api/mexal/automation');assert.deepEqual(JSON.parse(call.options.body),{action:'document_club_urls',ids:[id]});assert.equal(call.options.headers.Authorization,'Bearer public-session');assert.equal(res.headers['Cache-Control'],'private, no-store');
  let invalid=response();await proxy({method:'POST',body:{document_ids:Array(41).fill(id)},headers:{}},invalid);assert.equal(invalid.statusCode,400);
  invalid=response();await proxy({method:'GET'},invalid);assert.equal(invalid.statusCode,405);
 } finally {globalThis.fetch=original;}
});
