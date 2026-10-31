import test from "node:test";
import assert from "node:assert/strict";
import {cameraVideoConstraints,configureCameraFocus,preferredRearCamera,focusPointInPreview,openBarcodeCamera} from "../src/pages/Warehouse/cameraSettings.js";

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

});

test("touch focus maps the visible image, excludes letterboxing and requests the selected point",async()=>{
 const rect={left:10,top:20,width:400,height:400};
 assert.deepEqual(focusPointInPreview(210,220,rect,1920,1080),{x:0.5,y:0.5});
 assert.equal(focusPointInPreview(200,40,rect,1920,1080),null);
 assert.equal(focusPointInPreview(200,40,rect,0,0),null);
 const calls=[];const point={x:0.25,y:0.75};
 const track={getCapabilities:()=>({focusMode:["continuous","single-shot"]}),applyConstraints:async c=>calls.push(c)};
 assert.equal(await configureCameraFocus(track,point),true);
 assert.deepEqual(calls[0],{advanced:[{focusMode:"single-shot",pointsOfInterest:[point]}]});
 calls.length=0;track.applyConstraints=async c=>{calls.push(c);if(c.advanced[0].pointsOfInterest)throw Error("point unsupported");};
 assert.equal(await configureCameraFocus(track,point),true);assert.equal(calls[1].advanced[0].focusMode,"single-shot");
});
test("automatically chooses a rear lens with autofocus and releases rejected and late streams",async()=>{
 const opened=[],stopped=[];let cancelled=false;
 const media={enumerateDevices:async()=>[{kind:"videoinput",deviceId:"fixed",label:"camera 0, facing back"},{kind:"videoinput",deviceId:"front",label:"Front Camera"},{kind:"videoinput",deviceId:"main",label:"camera 2, facing back"}],getUserMedia:async c=>{
   const id=c.video.deviceId?.exact || "fixed";opened.push(id);
   const track={getCapabilities:()=>({focusMode:id==="main"?["continuous"]:[]}),getSettings:()=>({deviceId:id}),label:id,stop:()=>stopped.push(id)};
   return{getTracks:()=>[track],getVideoTracks:()=>[track]};
 }};
 const stream=await openBarcodeCamera(media);assert.equal(stream.getVideoTracks()[0].getSettings().deviceId,"main");assert.deepEqual(opened,["fixed","main"]);assert.deepEqual(stopped,["fixed"]);
 const late={...media,getUserMedia:async c=>{const result=await media.getUserMedia(c);cancelled=true;return result;}};
 assert.equal(await openBarcodeCamera(late,()=>cancelled),null);assert.equal(stopped.at(-1),"fixed");
});
