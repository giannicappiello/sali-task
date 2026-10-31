import test from "node:test";
import assert from "node:assert/strict";
import {cameraVideoConstraints,configureCameraFocus,numericCameraRange,preferredRearCamera} from "../src/pages/Warehouse/cameraSettings.js";

test("requests native HD without a resolution ceiling, preserving explicit camera selection",()=>{
 const auto=cameraVideoConstraints(""); assert.equal(auto.width.ideal,1920); assert.equal(auto.width.max,undefined); assert.equal(auto.resizeMode.ideal,"none"); assert.equal(auto.facingMode.ideal,"environment");
 const selected=cameraVideoConstraints("rear-main");assert.equal(selected.deviceId.exact,"rear-main");assert.equal(selected.facingMode,undefined);
});
test("focus tries supported modes and survives driver refusal and fixed-focus devices",async()=>{
 const calls=[]; const track={getCapabilities:()=>({focusMode:["continuous","single-shot"]}),applyConstraints:async c=>{calls.push(c);if(c.advanced[0].focusMode==="continuous")throw Error("driver rejected");}};
 assert.equal(await configureCameraFocus(track),true);assert.deepEqual(calls.map(c=>c.advanced[0].focusMode),["continuous","single-shot"]);
 assert.equal(await configureCameraFocus({getCapabilities:()=>({})}),false);
 assert.equal(await configureCameraFocus({getCapabilities:()=>{throw Error("unsupported");}}),false);
 assert.equal(await configureCameraFocus({...track,applyConstraints:async()=>{throw Error("driver");}}),false);
});
test("lens preference avoids identifiable ultra-wide lenses without guessing device numbers",()=>{
 const devices=[{kind:"videoinput",deviceId:"ultra",label:"Back Ultra Wide Camera"},{kind:"videoinput",deviceId:"main",label:"Back Camera"},{kind:"videoinput",deviceId:"front",label:"Front Camera"}];
 assert.equal(preferredRearCamera(devices,"ultra").deviceId,"main");assert.equal(preferredRearCamera(devices,"main"),null);
 assert.equal(preferredRearCamera([{kind:"videoinput",deviceId:"0",label:"camera 0"},{kind:"videoinput",deviceId:"1",label:"camera 1"}],"0"),null);
 assert.equal(numericCameraRange({min:0,max:0}),null);assert.equal(numericCameraRange({min:0,max:10,step:1}).step,1);
});
