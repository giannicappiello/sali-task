import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { beautyVisitStartsAt } from '../src/modules/pharmacy/services/beautyVisitTime.js';

test('visit timestamps accept both HTML and database time values', () => {
  for (const [time, expected] of [
    ['09:00', '09:00:00'], ['09:00:00', '09:00:00'],
    ['15:42:31', '15:42:31'], ['09:00:00.123456', '09:00:00.123456'],
    [null, '09:00:00'], ['', '09:00:00'],
  ]) assert.equal(beautyVisitStartsAt('2026-11-10', time), `2026-11-10T${expected}`);
  for (const time of ['09:00:00:00', '24:00', '09:60', 'not-a-time']) {
    assert.throws(() => beautyVisitStartsAt('2026-11-10', time), /non valida/);
  }
});

test('all three visit creation paths send valid RPC timestamps and retain legacy idempotency', async () => {
  const calls = [];
  const fixtureKey = `beautyTimeFixture${crypto.randomUUID()}`;
  const query = {
    select() { return this; }, eq() { return this; }, update() { return this; },
    async single() { return { data: { report_data: {} }, error: null }; },
    then(resolve, reject) { return Promise.resolve({ error: null }).then(resolve, reject); },
  };
  globalThis[fixtureKey] = {
    functions: { async invoke() { return { data: null, error: null }; } },
    from() { return query; },
    async rpc(name, args) {
      calls.push({ name, args });
      assert.ok(!Number.isNaN(new Date(args.p_starts_at).getTime()), args.p_starts_at);
      return { data: { activity_id: 'visit-id' }, error: null };
    },
  };
  try {
    const helper = new URL('../src/modules/pharmacy/services/beautyVisitTime.js', import.meta.url).href;
    const source = (await readFile(new URL('../src/modules/pharmacy/services/beautyVisitCrm.js', import.meta.url), 'utf8'))
      .replace('import { supabase } from "../../../lib/supabaseClient";', `const supabase = globalThis[${JSON.stringify(fixtureKey)}];`)
      .replace('"./beautyVisitTime.js"', JSON.stringify(helper));
    const service = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
    const client = { codice_cliente: 'C001', nome: 'Cliente test' };
    for (const time of ['09:00', '09:00:00', null]) {
      await service.ensureCrmBeautyVisit({ giornata: { id: 'legacy-id', data: '2026-11-10', ora_inizio: time }, client });
      assert.equal(calls.at(-1).args.p_starts_at, '2026-11-10T09:00:00');
      assert.equal(calls.at(-1).args.p_idempotency_key, 'beauty-legacy:legacy-id');
      assert.equal(calls.at(-1).args.p_legacy_giornata_id, 'legacy-id');
      await service.createCrmBeautyCustomerVisit({ client, data: '2026-11-10', oraInizio: time });
      assert.equal(calls.at(-1).args.p_starts_at, '2026-11-10T09:00:00');
      await service.createCrmBeautyContactVisit({ name: 'Contatto test', data: '2026-11-10', oraInizio: time, idempotencyKey: 'contact-test' });
      assert.equal(calls.at(-1).args.p_starts_at, '2026-11-10T09:00:00');
    }
    assert.equal(calls.length, 9);
  } finally { delete globalThis[fixtureKey]; }
});
