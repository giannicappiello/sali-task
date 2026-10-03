import test from 'node:test';
import assert from 'node:assert/strict';
import { stationPopupSize } from './stationPopupSize.js';
for (const viewport of [{width:776,height:973},{width:1920,height:1080},{width:390,height:844},{width:844,height:390}]) {
  for (const height of [1920,2300]) test(`Station fills popup at ${viewport.width}x${viewport.height}, content ${height}`, () => {
    const result = stationPopupSize({width:1080,height},viewport,60);
    assert.ok(result.width <= viewport.width - 16);
    assert.ok(result.height <= viewport.height - 16);
    assert.ok(Math.abs((result.width - 2) / (result.height - 62) - 1080 / height) < 1e-10);
  });
}
test('Invalid size is rejected', () => {
  assert.equal(stationPopupSize({width:NaN,height:1920},{width:776,height:973},60),null);
});