import test from 'node:test';
import assert from 'node:assert/strict';
import { mapsSearchUrl, parseCoordinates } from '../src/modules/hr/hrLocation.js';
test('Google Maps point accepts valid coordinates and rejects ambiguous input', () => {
  assert.deepEqual(parseCoordinates(' 41.9028, -12.4964 '), { latitude: 41.9028, longitude: -12.4964 });
  for (const input of ['', '91, 12', '41, 181', 'https://maps.app.goo.gl/example', '41,90,12,49']) assert.throws(() => parseCoordinates(input));
  const url = new URL(mapsSearchUrl('Via Roma 1 & ingresso B'));
  assert.equal(url.hostname, 'www.google.com');
  assert.equal(url.searchParams.get('query'), 'Via Roma 1 & ingresso B');
});
