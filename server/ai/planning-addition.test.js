/* global process */
import test from 'node:test';
import assert from 'node:assert/strict';
import { planningCall, planningRequestSchema } from './planning-lifecycle.js';
import { HMAC_HEADERS, signProductionMessage } from '../progremes-production-hmac.js';

test('addition and complete revision use authenticated signed MES operations', async () => {
  const oldSecret = process.env.PROGREMES_INTEGRATION_SECRET, oldUrl = process.env.PROGREMES_URL;
  process.env.PROGREMES_INTEGRATION_SECRET = 'test-only-secret';
  process.env.PROGREMES_URL = 'https://mes.example.test';
  try {
    const auth = { profile: { id: 'operator' }, scoped: { rpc: async name => {
      assert.equal(name, 'company_mes_ai_can_write'); return { data: true };
    } } };
    for (const operation of ['addition-candidates', 'addition-preview', 'order-revision']) {
      const result = await planningCall(auth, operation, { orderId: 80, lineId: -261, actor: 'spoofed' }, async (url, options) => {
        assert.equal(url.pathname, `/api/workspace/ai/planning/${operation}`);
        assert.equal(JSON.parse(options.body).actor, 'workspace:operator');
        assert.equal(JSON.parse(options.body).lineId, -261);
        assert.equal(options.headers[HMAC_HEADERS.signature], signProductionMessage({ method: 'POST', path: url.pathname,
          timestamp: Number(options.headers[HMAC_HEADERS.timestamp]), eventId: options.headers[HMAC_HEADERS.eventId],
          body: options.body, secret: 'test-only-secret' }));
        return new Response(JSON.stringify({ status: 'PROPOSED' }));
      });
      assert.equal(result.status, 'PROPOSED');
    }
    assert.equal(planningRequestSchema.properties.planOnly.type, 'boolean');
    await assert.rejects(planningCall({ ...auth, scoped: { rpc: async () => ({ data: false }) } }, 'addition-preview', {}, () => { throw Error('must not send'); }), /Permesso/);
    await assert.rejects(planningCall(auth, 'arbitrary-write'), /non disponibile/);
  } finally {
    if (oldSecret === undefined) delete process.env.PROGREMES_INTEGRATION_SECRET; else process.env.PROGREMES_INTEGRATION_SECRET = oldSecret;
    if (oldUrl === undefined) delete process.env.PROGREMES_URL; else process.env.PROGREMES_URL = oldUrl;
  }
});
