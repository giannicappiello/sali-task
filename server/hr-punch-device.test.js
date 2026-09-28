import test from 'node:test';
import assert from 'node:assert/strict';
import { usesMobileLocation } from '../src/modules/hr/hrPunchDevice.js';
test('desktop uses company network, phones and tablets use location', () => {
  for (const userAgent of ['Windows NT 10.0', 'Macintosh', 'X11; Linux x86_64']) assert.equal(usesMobileLocation({userAgent,maxTouchPoints:0}),false);
  for (const userAgent of ['iPhone', 'iPad', 'Android']) assert.equal(usesMobileLocation({userAgent}),true);
  assert.equal(usesMobileLocation({userAgent:'Macintosh',maxTouchPoints:5}),true);
  assert.equal(usesMobileLocation({userAgent:'Windows NT 10.0',maxTouchPoints:10}),false);
});
