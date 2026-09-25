import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldSendObservation } from '../src/modules/hr/hrGpsObservation.js';
const now = 1000000, site = { site_latitude: 41, site_longitude: 14, checkout_radius: 100 };
const point = (latitude = 41, accuracy = 5, timestamp = now) => ({ coords: { latitude, longitude: 14, accuracy }, timestamp });
test('first outside point bypasses inside throttling; uncertain boundary does not', () => {
  assert.equal(shouldSendObservation(point(), site, now - 1000, now), false);
  assert.equal(shouldSendObservation(point(41.01), site, now - 1000, now), true);
  assert.equal(shouldSendObservation(point(41.0009, 20), site, now - 1000, now), false);
  assert.equal(shouldSendObservation(point(), site, now - 15000, now), true);
});
test('poor, stale, future and invalid positions are never sent for checkout', () => {
  for (const p of [point(41.01, 51), point(41.01, 5, now - 31000), point(41.01, 5, now + 6000), point(NaN), point(91)])
    assert.equal(shouldSendObservation(p, site, 0, now), false);
});
