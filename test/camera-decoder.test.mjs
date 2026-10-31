import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {createCameraDecoder} from "../src/pages/Warehouse/cameraDecoder.js";
import {createScanCandidate,createNextScanGate,barcodeReadOptions,nearestBarcode} from "../src/pages/Warehouse/barcodeWorkerCore.js";
import {prepareZXingModule,readBarcodes} from "zxing-wasm/reader";
import {prepareZXingModule as prepareWriter,writeBarcode} from "zxing-wasm/writer";

function workerFixture(){
 const sent=[];const worker={terminate(){this.stopped=true;},postMessage(data,transfer){sent.push({data,transfer});}};
 const source={readyState:4,videoWidth:10,videoHeight:10};
 const factory=()=>{queueMicrotask(()=>worker.onmessage({data:{type:"ready"}}));return worker;};
 const canvas=()=>({getContext:()=>({drawImage(){},getImageData:()=>({width:10,height:10,data:new Uint8ClampedArray(400)})})});
 return{worker,sent,source,options:{workerFactory:factory,createCanvas:canvas}};
}
test("worker transfers native pixels and serializes reads; disposal terminates pending work",async()=>{
 const f=workerFixture(),read=await createCameraDecoder(f.options);
 const result=read(f.source);assert.equal(f.sent[0].data.width,10);assert.equal(f.sent[0].transfer[0],f.sent[0].data.buffer);
 await assert.rejects(read(f.source),/già in corso/);
 f.worker.onmessage({data:{type:"result",id:1,code:"IT0017"}});assert.equal(await result,"IT0017");
 const pending=read(f.source);read.dispose();await assert.rejects(pending,/chiuso/);assert.equal(f.worker.stopped,true);
 await assert.rejects(read(f.source),/chiuso/);
});
test("an aborted startup stops the worker before it can retain a camera session",async()=>{
 const controller=new AbortController(),worker={terminate(){this.stopped=true;}};
 const start=createCameraDecoder({signal:controller.signal,workerFactory:()=>worker,createCanvas:()=>({})});
 controller.abort();await assert.rejects(start,/chiuso/);assert.equal(worker.stopped,true);
});
test("preview candidates never count products, expire quickly and are consumed only once",()=>{
 const c=createScanCandidate();c.update("IT0017",100);assert.equal(c.take(200),"IT0017");assert.equal(c.take(201),null);
 c.update("IT0017",300);c.update(null,400);assert.equal(c.take(450),null);
 c.update("IT0017",500);assert.equal(c.take(1500),null);c.update("IT0018",1600);c.clear();assert.equal(c.take(1601),null);
});

function photographedSymbol(symbol,angle,invert=false){
 const width=800,height=600,data=new Uint8ClampedArray(width*height*4),cos=Math.cos(angle),sin=Math.sin(angle),scale=3;
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const sx=Math.floor(((x-width/2)*cos+(y-height/2)*sin)/scale+symbol.width/2),sy=Math.floor((-(x-width/2)*sin+(y-height/2)*cos)/scale+symbol.height/2);
  const inside=sx>=0&&sx<symbol.width&&sy>=0&&sy<symbol.height;
  const bit=inside?symbol.data[sy*symbol.width+sx]:255;
  const shade=(invert?255-bit:bit)>127?210:48;
  const i=(y*width+x)*4,value=shade+Math.round(12*x/width)+((x*17+y*31)%9)-4;
  data[i]=data[i+1]=data[i+2]=value;data[i+3]=255;
 }
 // A small horizontal optical blur, without changing the expected value.
 const original=data.slice();for(let y=0;y<height;y++)for(let x=1;x<width-1;x++)for(let ch=0;ch<3;ch++){const i=(y*width+x)*4+ch;data[i]=(original[i-4]+2*original[i]+original[i+4])/4;}
 return{width,height,data};
}
test("real C++ reader decodes rotated, low-contrast, noisy and slightly blurred EAN, Code128 and QR labels",async()=>{
 await prepareZXingModule({overrides:{wasmBinary:await readFile(new URL(import.meta.resolve("zxing-wasm/reader/zxing_reader.wasm")))},fireImmediately:true});
 await prepareWriter({overrides:{wasmBinary:await readFile(new URL(import.meta.resolve("zxing-wasm/writer/zxing_writer.wasm")))},fireImmediately:true});
 for(const [format,text,angle,invert] of [["EAN13","4006381333931",Math.PI/2,false],["Code128","IT0017",0.21,false],["QRCode","https://prodotti.example/scheda?codice=IT0017",-0.18,true]]){
  const output=await writeBarcode(text,{format});assert.equal(output.error,"");
  const image=photographedSymbol(output.symbol,angle,invert);
  const results=await readBarcodes(image,barcodeReadOptions);
  assert.equal(nearestBarcode(results,image.width,image.height),text,format);
 }
});

test("a confirmed label must leave or change before automatic capture can hold the next product",()=>{
 const gate=createNextScanGate();assert.equal(gate.observe("IT0001"),"IT0001");gate.confirm("IT0001");
 assert.equal(gate.observe("IT0001"),null);assert.equal(gate.observe("IT0001"),null);assert.equal(gate.observe("IT0002"),"IT0002");
 gate.confirm("IT0002");assert.equal(gate.observe(null),null);assert.equal(gate.observe("IT0002"),"IT0002");
 gate.confirm("IT0002");gate.reset();assert.equal(gate.observe("IT0002"),"IT0002");
});
