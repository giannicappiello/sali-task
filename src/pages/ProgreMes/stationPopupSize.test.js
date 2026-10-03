import test from 'node:test';
import assert from 'node:assert/strict';
import { stationPopupSize } from './stationPopupSize.js';
for (const viewport of [{width:776,height:973},{width:390,height:844},{width:844,height:390}]) {
  for (const height of [1920,2300]) test(`Portrait stays within ${viewport.width}x${viewport.height}`, () => {
    const result = stationPopupSize({width:1080,height},viewport,60);
    assert.ok(result.width <= viewport.width - 16);
    assert.ok(result.height <= viewport.height - 16);
    assert.ok(Math.abs((result.width - 2) / (result.height - 62) - 1080 / height) < 1e-10);
  });
}
for (const viewport of [{width:1920,height:1080},{width:1366,height:768},{width:1024,height:768}]) {
  test(`Desktop uses available width at ${viewport.width}x${viewport.height}`, () => {
    const result = stationPopupSize({width:1080,height:1920},viewport,60);
    assert.equal(result.width,Math.min(1440,viewport.width-18));
    assert.equal(result.height,viewport.height-18);
    const previousScale=(viewport.height-78)/1920;
    assert.ok(1/previousScale>=1.9);
  });
}
test('Invalid size is rejected', () => {
  assert.equal(stationPopupSize({width:NaN,height:1920},{width:776,height:973},60),null);
});
