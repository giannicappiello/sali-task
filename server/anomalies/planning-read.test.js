import test from 'node:test';
import assert from 'node:assert/strict';
import { planningCall } from '../ai/planning-lifecycle.js';
test('planning snapshot uses only the read gate; simulation still requires write', async () => {
 const previous = { secret: globalThis.process.env.PROGREMES_INTEGRATION_SECRET, url: globalThis.process.env.PROGREMES_URL };
 globalThis.process.env.PROGREMES_INTEGRATION_SECRET = 'fixture-secret'; globalThis.process.env.PROGREMES_URL = 'https://mes.example';
 try {
  const calls = [], auth = { profile: { id: 'fixture-user' }, scoped: { rpc: async name => { calls.push(name); return { data: name === 'workspace_planning_can_read_snapshot' }; } } };
  const transport = async (url, options) => { assert.match(url.pathname, /\/state$/); assert.equal(JSON.parse(options.body).actor, 'workspace:fixture-user'); return Response.json({ configuration: {} }); };
  await planningCall(auth, 'state', {}, transport); assert.deepEqual(calls, ['workspace_planning_can_read_snapshot']);
  await assert.rejects(planningCall(auth, 'simulate', {}, transport), /Permesso operativo/); assert.equal(calls[1], 'company_mes_ai_can_write');
  await assert.rejects(planningCall({ ...auth, scoped: { rpc: async () => ({ error: Error('unavailable') }) } }, 'state', {}, transport), /Lettura planning/);
 } finally {
  for (const [name, value] of [['PROGREMES_INTEGRATION_SECRET', previous.secret], ['PROGREMES_URL', previous.url]]) if (value === undefined) delete globalThis.process.env[name]; else globalThis.process.env[name] = value;
 }
});
