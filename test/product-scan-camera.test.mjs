import test from "node:test";
import assert from "node:assert/strict";
import {productCodeInScan} from "../shared/productScan.js";
import {createFrameDecoder,cameraErrorMessage} from "../src/pages/Warehouse/barcodeFrame.js";

test("extracts one IT identifier from direct values, URLs and encoded QR contents without navigation",()=>{
 for(const value of ['IT0017','it0017','https://example.test/catalogo/IT0017.html','https://example.test/?product=IT0017','https://example.test/?product=%49%54%30%30%31%37','{"codice_articolo":"IT0017"}']) assert.equal(productCodeInScan(value),'IT0017');
 assert.equal(productCodeInScan('4006381333931'),null);
 assert.throws(()=>productCodeInScan('https://example.test/?product=IT0017&other=IT0018'),/più codici/);
 assert.throws(()=>productCodeInScan('x'.repeat(4097)),/4096/);
});
class Miss extends Error { static kind='NotFoundException'; }
function frameFixture(decode){
 const calls=[];const canvases=[];
 const factory=()=>{const canvas={getContext:()=>({drawImage:(...args)=>calls.push(['draw',...args]),translate:(...args)=>calls.push(['translate',...args]),rotate:(angle)=>calls.push(['rotate',angle])})};canvases.push(canvas);return canvas;};
 return {read:createFrameDecoder({decodeFromCanvas:decode},factory),calls,canvases};
}
test("one manual capture tries both orientations and reports the decoded value exactly once",()=>{
 let attempts=0;const f=frameFixture(()=>{if(++attempts===1)throw new Miss();return{getText:()=> 'https://example.test/IT0017'};});
 assert.equal(f.read({readyState:2,videoWidth:1280,videoHeight:720}),'https://example.test/IT0017');assert.equal(attempts,2);
 assert.equal(f.canvases[1].width,720);assert.equal(f.canvases[1].height,1280);assert.ok(f.calls.some(row=>row[0]==='rotate'&&row[1]===Math.PI/2));
});
test("normal misses do not disable later captures and fatal frame errors are visible to the caller",()=>{
 let fail=true;const f=frameFixture(()=>{if(fail)throw new Miss();return{getText:()=> 'IT0017'};});
 assert.equal(f.read({readyState:2,videoWidth:640,videoHeight:480}),null);fail=false;assert.equal(f.read({readyState:2,videoWidth:640,videoHeight:480}),'IT0017');
 const fatal=frameFixture(()=>{throw new Error('Canvas failure');});assert.throws(()=>fatal.read({readyState:2,videoWidth:640,videoHeight:480}),/Canvas failure/);
 assert.throws(()=>f.read({readyState:0,videoWidth:0,videoHeight:0}),/Attendi/);
 assert.match(cameraErrorMessage({name:'NotAllowedError'}),/Accesso.*negato/);
});


test("full resolution photos decode independently of video readiness",()=>{
 const f=frameFixture(()=>({getText:()=>"IT0017"}));
 assert.equal(f.read({naturalWidth:4032,naturalHeight:3024}),"IT0017");
 assert.equal(f.canvases[0].width,4032);assert.equal(f.canvases[0].height,3024);
});
