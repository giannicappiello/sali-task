import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldSendObservation } from '../src/modules/hr/hrGpsObservation.js';
import { gpsErrorMessage } from '../src/modules/hr/hrGpsErrors.js';
const now=1000000;
const point=(latitude=41,accuracy=18,timestamp=now)=>({coords:{latitude,longitude:14,accuracy},timestamp});
test('every fresh point is sent immediately; no inside throttle can drop the first outside point',()=>{
  for(const p of [point(),point(41.001),point(41.0014),point(41.01),point(41.01,31),point(41.01,100)])
    assert.equal(shouldSendObservation(p,{},now,now),true);
});
test('invalid or expired GPS observations cannot reach presence evaluation',()=>{
  for(const p of [point(NaN),point(91),point(41,-1),point(41,Infinity),point(41,18,now-31000),point(41,18,now+6000)])
    assert.equal(shouldSendObservation(p,{},0,now),false);
});
test('GPS permission, unavailable and timeout messages match the actual browser cause',()=>{
  assert.match(gpsErrorMessage({code:1}),/Permesso posizione negato/);
  assert.match(gpsErrorMessage({code:2}),/Posizione non disponibile/);
  assert.match(gpsErrorMessage({code:3}),/Timeout/);
  assert.match(gpsErrorMessage({}),/Impossibile acquisire/);
});
