import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveMesPackagingSpecification, specificationPiecesPerBox, PACKAGING_SPECIFICATION_PATH } from './mes-packaging-specification.js';
import { HMAC_HEADERS, signProductionMessage } from './progremes-production-hmac.js';
const secret = 'test-only-integration-key';
function request(articleCode = 'IT0491') {
  const body = { action: 'mes_packaging_specification', articleCode };
  const timestamp = Math.floor(Date.now() / 1000), eventId = 'test-spec';
  return { body, headers: { [HMAC_HEADERS.timestamp]: String(timestamp), [HMAC_HEADERS.eventId]: eventId,
    [HMAC_HEADERS.signature]: signProductionMessage({ method: 'POST', path: PACKAGING_SPECIFICATION_PATH, timestamp, eventId, body: JSON.stringify(body), secret }) } };
}
function database(row) {
  return { from: table => { assert.equal(table, 'workspace_product_specifications'); return { select: columns => { assert.equal(columns, 'article_code,version,data'); return { eq: (key, code) => { assert.equal(key, 'article_code'); assert.equal(code, 'IT0491'); return { maybeSingle: async () => ({ data: row }) }; } }; } }; } };
}
test('only valid whole pieces in saved specification are automatic', () => {
  assert.equal(specificationPiecesPerBox('12'), 12); assert.equal(specificationPiecesPerBox(' 24 '), 24);
  for (const input of ['', null, '12 pz', '12.5', '-3', '0', '1.000', 1000000001]) assert.equal(specificationPiecesPerBox(input), null);
});
test('signed MES lookup returns only packaging quantity and revision', async () => {
  const req = request();
  const result = await resolveMesPackagingSpecification(req, req.body, { env: { PROGREMES_INTEGRATION_SECRET: secret }, adminFactory: () => database({ version: 3, data: { piecesPerBox: '12', customer: 'private' } }) });
  assert.deepEqual(result, { articleCode: 'IT0491', piecesPerBox: 12, specificationVersion: 3 });
});
test('missing specification permits manual entry; database failures are not mistaken for absence', async () => {
  const req = request();
  assert.equal((await resolveMesPackagingSpecification(req, req.body, { env: { PROGREMES_INTEGRATION_SECRET: secret }, adminFactory: () => database(null) })).piecesPerBox, null);
  await assert.rejects(resolveMesPackagingSpecification(req, req.body, { env: { PROGREMES_INTEGRATION_SECRET: secret }, adminFactory: () => { throw new Error('Database unavailable'); } }), /Database unavailable/);
});
test('invalid signature or altered article cannot read the specification', async () => {
  const req = request(); req.body.articleCode = 'IT0002';
  await assert.rejects(resolveMesPackagingSpecification(req, req.body, { env: { PROGREMES_INTEGRATION_SECRET: secret }, adminFactory: () => { throw new Error('must not read'); } }), { status: 401 });
});
