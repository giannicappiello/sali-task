import test from 'node:test';
import assert from 'node:assert/strict';
import { addActivityStatus, isArchivedTask, projectArchiveStatus } from './activity-status.js';

const project = { id: 'p', stato: 'aperto', updated_at: '2026-11-02T13:31:05Z' };
test('timestamp closes a task even when its raw dropdown is open', () => {
  for (const stato of ['da_evadere', 'in_lavorazione']) {
    const phase = { stato, completato_at: '2026-11-02T13:31:05Z' };
    assert.equal(isArchivedTask(phase), true);
    const result = projectArchiveStatus(project, [phase]);
    assert.equal(result.stato, 'aperto');
    assert.equal(result.stato_archivio, 'chiuso');
    assert.equal(result.chiusura_archivio, phase.completato_at);
  }
});
test('empty and mixed projects stay open, department flags alone do not close archive', () => {
  for (const phases of [[], [{ stato: 'evaso' }, { stato: 'da_evadere' }], [{ stato: 'in_lavorazione', completato: true }]]) {
    assert.equal(projectArchiveStatus(project, phases).stato_archivio, 'aperto');
  }
});
test('archive terminal states and date precedence match UI', () => {
  for (const stato of ['EVASO', 'evasa', ' completato ', 'completata', 'chiuso', 'chiusa', 'annullato', 'annullata']) {
    assert.equal(isArchivedTask({ stato }), true);
    assert.equal(projectArchiveStatus({ ...project, stato }, []).stato_archivio, 'chiuso');
  }
  assert.equal(projectArchiveStatus(project, [{ stato: 'evaso', updated_at: '2026-10-01' }, { stato: 'evaso', completato_at: '2026-11-02', updated_at: '2026-11-07' }]).chiusura_archivio, '2026-11-02');
});
function client(pages) {
  const calls = [];
  return { calls, from(table) {
    assert.equal(table, 'v4_fasi_progetto');
    return {
      select(columns, options) { assert.equal(columns, 'id,progetto_id,stato,completato_at,updated_at'); assert.deepEqual(options, { count: 'exact' }); return this; },
      in(column, ids) { assert.equal(column, 'progetto_id'); assert.deepEqual(ids, ['p']); return this; },
      order(column) { assert.equal(column, 'id'); return this; },
      range(start, end) { calls.push([start, end]); return pages.shift(); },
    };
  } };
}
test('reads every RLS page even when the server caps pages below requested size', async () => {
  const scoped = client([{ data: [{ id: '1', progetto_id: 'p', stato: 'evaso' }], count: 2 }, { data: [{ id: '2', progetto_id: 'p', stato: 'aperto', completato_at: '2026-11-02' }], count: 2 }]);
  const [result] = await addActivityStatus(scoped, 'projects', [project]);
  assert.equal(result.stato_archivio, 'chiuso');
  assert.equal(result.fasi_visibili, 2);
  assert.deepEqual(scoped.calls, [[0,499], [1,500]]);
});
test('fails closed for unavailable, incomplete, excessive, changing or duplicate coverage', async () => {
  const row = { id: '1', progetto_id: 'p', stato: 'evaso' };
  for (const pages of [[{ data: [], count: null }], [{ data: [], count: 1 }], [{ data: [], count: 10001 }], [{ data: [row], count: 2 }, { data: [row], count: 3 }], [{ data: [row, row], count: 2 }], [{ error: new Error('RLS read failed') }]]) {
    await assert.rejects(addActivityStatus(client(pages), 'projects', [project]));
  }
});
test('tasks expose completion while CRM and empty results incur no extra reads', async () => {
  const scoped = { from() { throw new Error('Unexpected query'); } };
  assert.deepEqual(await addActivityStatus(scoped, 'projects', []), []);
  assert.deepEqual(await addActivityStatus(scoped, 'crm_accounts', [project]), [project]);
  const [result] = await addActivityStatus(scoped, 'tasks', [{ stato: 'da_evadere', completato_at: '2026-11-02' }]);
  assert.equal(result.stato_archivio, 'chiuso');
  assert.equal(result.stato, 'da_evadere');
});
