import test from "node:test";
import assert from "node:assert/strict";
import {createCameraDecoder} from "../src/pages/Warehouse/cameraDecoder.js";
const source={readyState:2,videoWidth:1280,videoHeight:720};
const canvas=()=>({getContext:()=>({drawImage(){},translate(){},rotate(){}})});
test("uses the browser native reader first and chooses the code closest to image centre",async()=>{
 let fallback=0;class Native{static async getSupportedFormats(){return["qr_code","ean_13"];}async detect(){return[{rawValue:"IT0002",boundingBox:{x:10,y:10,width:20,height:20}},{rawValue:"IT0001",boundingBox:{x:620,y:340,width:40,height:40}}];}}
 const read=await createCameraDecoder({decodeFromCanvas(){fallback++;throw Error("must not run");}},Native,canvas);
 assert.equal(await read(source),"IT0001");assert.equal(fallback,0);
});
test("native misses and driver failures preserve the ZXing fallback",async()=>{
 let fail=false,calls=0;class Native{static async getSupportedFormats(){return["ean_13"];}async detect(){calls++;if(fail)throw Error("driver");return[];}}
 const read=await createCameraDecoder({decodeFromCanvas:()=>({getText:()=>"4006381333931"})},Native,canvas);
 assert.equal(await read(source),"4006381333931");fail=true;assert.equal(await read(source),"4006381333931");assert.equal(await read(source),"4006381333931");assert.equal(calls,2);
});
test("unsupported native detection and unsupported format queries do not disable scanning",async()=>{
 for(const Detector of [null,class{static async getSupportedFormats(){throw Error("unsupported");}}]){
 const read=await createCameraDecoder({decodeFromCanvas:()=>({getText:()=>"IT0017"})},Detector,canvas);assert.equal(await read(source),"IT0017");
 }
});
