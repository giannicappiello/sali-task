import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../apps/salidischia-club/api/club-pdf-preview.js';
const id='a284bb41-7d24-4832-8c28-0fd10632cffd';
function response(){return{headers:{},setHeader(k,v){this.headers[k]=v;},status(s){this.statusCode=s;return this;},json(x){this.body=x;return this;},send(x){this.body=x;return this;}};}
test('PDF preview resolves Workspace access before fetching bytes and forwards identity',async()=>{
  const original=globalThis.fetch,calls=[];
  globalThis.fetch=async(url,options)=>{calls.push({url,options});return calls.length===1?Response.json({urls:{[id]:'https://gateway.example/signed.pdf'}}):new Response('%PDF-1.4 fixture',{status:206,headers:{'Content-Type':'application/pdf','Content-Range':'bytes 0-15/16'}});};
  try{const res=response();await handler({method:'POST',body:{document_id:id},headers:{authorization:'Bearer fixture-token'}},res);assert.equal(res.statusCode,206);assert.equal(calls[0].url,'https://workspace.progre.it/api/mexal/automation');assert.deepEqual(JSON.parse(calls[0].options.body),{action:'document_club_urls',ids:[id]});assert.equal(calls[0].options.headers.Authorization,'Bearer fixture-token');assert.equal(calls[1].options.redirect,'error');assert.equal(res.headers['Cache-Control'],'private, no-store');assert.match(res.body.toString(),/^%PDF/);}finally{globalThis.fetch=original;}
});
test('denied and unavailable documents never fetch remote bytes; arbitrary URLs are rejected',async()=>{
 const original=globalThis.fetch;
 try{for(const denied of [true,false]){let calls=0;globalThis.fetch=async()=>{calls++;return Response.json(denied?{error:'private'}:{urls:{}},{status:denied?403:200});};const res=response();await handler({method:'POST',body:{document_id:id},headers:{}},res);assert.equal(res.statusCode,denied?403:404);assert.equal(calls,1);}
 let calls=0;globalThis.fetch=async()=>{calls++;throw Error('must not fetch');};const res=response();await handler({method:'POST',body:{document_id:'https://arbitrary.example/private'},headers:{}},res);assert.equal(res.statusCode,400);assert.equal(calls,0);
 }finally{globalThis.fetch=original;}
});
test('non-PDF responses cannot be rendered as active content',async()=>{
 const original=globalThis.fetch;let calls=0;globalThis.fetch=async()=>++calls===1?Response.json({urls:{[id]:'https://gateway.example/signed'}}):new Response('<script>bad()</script>',{headers:{'Content-Type':'text/html'}});
 try{const res=response();await handler({method:'POST',body:{document_id:id},headers:{}},res);assert.equal(res.statusCode,415);assert.equal(res.headers['Content-Type'],undefined);}finally{globalThis.fetch=original;}
});
