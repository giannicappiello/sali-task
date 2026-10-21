import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
process.env.NODE_ENV='production';
globalThis.self=globalThis;
globalThis.location=new URL('https://workspace.example/sw.js');
class WorkerEvent extends Event { waitUntil() {} }
globalThis.ExtendableEvent=WorkerEvent;
globalThis.FetchEvent=WorkerEvent;
const {NetworkFirst}=await import('workbox-strategies/NetworkFirst.js');
const {PrecacheFallbackPlugin}=await import('workbox-precaching/PrecacheFallbackPlugin.js');
const offline=fs.readFileSync('dist/offline.html','utf8');
let entries,route,strategy;
vm.runInNewContext(fs.readFileSync('dist/sw.js','utf8'),{
 self:{define(){},addEventListener(){}},importScripts(){},
 define(_deps,factory){factory({setCacheNameDetails(){},precacheAndRoute(e){entries=e;},cleanupOutdatedCaches(){},registerRoute(r,s){route=r;strategy=s;},NetworkFirst,
 PrecacheFallbackPlugin:class extends PrecacheFallbackPlugin {constructor(options){super({...options,precacheController:{matchPrecache:async url=>{assert.equal(url,'/offline.html');return new Response(offline,{headers:{'Content-Type':'text/html'}});}}});}},
 CacheableResponsePlugin:class {},ExpirationPlugin:class {},});},
});
test('generated worker precaches fallback and icon, while index remains fresh from network',()=>{
 assert.ok(entries.some(e=>e.url==='offline.html'));assert.ok(entries.some(e=>e.url==='apple-touch-icon.png'));assert.ok(!entries.some(e=>e.url==='index.html'));
 assert.equal(route({request:{mode:'navigate'},url:new URL('https://workspace.example/')}),true);
 for(const path of ['/api/orders','/assets/app.js'])assert.equal(route({request:{mode:'navigate'},url:new URL('https://workspace.example'+path)}),false);
});
test('actual NetworkFirst returns a page instead of no-response when network and runtime cache both fail',async()=>{
 const originalFetch=globalThis.fetch;const originalCaches=globalThis.caches;
 globalThis.fetch=async()=>{throw new TypeError('Network unavailable');};globalThis.caches={match:async()=>undefined,open:async()=>({match:async()=>undefined,put:async()=>{}})};
 try{
  await assert.rejects(new NetworkFirst().handle({request:new Request('https://workspace.example/'),event:new WorkerEvent('fetch')}),/no-response/);
  const result=await strategy.handle({request:new Request('https://workspace.example/'),event:new WorkerEvent('fetch')});
  assert.equal(result.status,200);assert.match(await result.text(),/Workspace non è raggiungibile/);
 }finally{globalThis.fetch=originalFetch;globalThis.caches=originalCaches;}
});
test('published manifest sizes match PNG bytes and Apple uses the actual logo asset',()=>{
 const manifest=JSON.parse(fs.readFileSync('dist/manifest.webmanifest','utf8'));
 for(const icon of manifest.icons){const png=fs.readFileSync('dist'+icon.src);assert.equal(icon.sizes,png.readUInt32BE(16)+'x'+png.readUInt32BE(20));}
 const html=fs.readFileSync('dist/index.html','utf8');assert.ok(html.includes('rel="apple-touch-icon" href="/apple-touch-icon.png?v=20261021"'));
 assert.ok(fs.readFileSync('dist/apple-touch-icon.png').equals(fs.readFileSync('public/apple-touch-icon.png')));
});
