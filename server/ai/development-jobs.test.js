import test from 'node:test';
import assert from 'node:assert/strict';
import { validateDevelopmentResult, requestDevelopmentJob, developmentTools } from './development-jobs.js';

test('explicit admin development requests enter the runnable queue without another confirmation', async () => {
  let inserted;
  const auth = { profile: { id: 'admin-id', ruoli: { amministratore_workspace: true } }, admin: {
    from: table => { assert.equal(table, 'ai_development_jobs'); return { insert: row => {
      inserted = row; return { select: () => ({ single: async () => ({ data: { id: 'job-id', ...row }, error: null }) }) };
    } }; },
  } };
  const result = await developmentTools(auth).CODE_CHANGE_REQUEST.execute({ repository: 'workspace', instruction: 'Correggi il codice della schermata richiesta.' });
  assert.equal(inserted.status, 'queued');
  assert.equal(inserted.user_id, 'admin-id');
  assert.ok(Number.isFinite(Date.parse(inserted.approved_at)));
  assert.equal(result.requiresConfirmation, false);
  assert.equal(result.changed, false);
  assert.equal(result.developmentJob.status, 'queued');
});

test('non-admin requests cannot enqueue jobs or enable code tools', async () => {
  const auth = { profile: { id: 'user-id', ruoli: { amministratore_workspace: false } }, admin: {
    from: () => { assert.fail('Database must not be accessed'); },
  } };
  assert.deepEqual(developmentTools(auth), {});
  await assert.rejects(requestDevelopmentJob(auth, { repository: 'workspace', instruction: 'Correggi il codice della schermata', status: 'queued' }), error => error.status === 403);
});

test('invalid development instructions cannot enter the queue', async () => {
  const auth = { profile: { ruoli: { amministratore_workspace: true } }, admin: { from: () => assert.fail('Invalid request must not be persisted') } };
  await assert.rejects(requestDevelopmentJob(auth, { repository: 'unknown', instruction: 'Modifica il codice richiesto' }));
  await assert.rejects(requestDevelopmentJob(auth, { repository: 'mes', instruction: '' }));
});

test('successful development completion requires matching source, checks and review commit', () => {
  const commit = 'a'.repeat(40);
  const valid = { baseCommit: commit, published: false, checks: [{ succeeded: true }], edits: [{ path: 'a.js' }], revision: { branch: 'codex/ai-00000000-0000-4000-8000-000000000000', commit: 'b'.repeat(40), published: false } };
  assert.doesNotThrow(() => validateDevelopmentResult(valid, commit));
  for (const invalid of [{ ...valid, baseCommit: 'c'.repeat(40) }, { ...valid, checks: [] }, { ...valid, checks: [{ succeeded: false }] }, { ...valid, revision: null }, { ...valid, published: true }, { ...valid, edits: [] }]) {
    assert.throws(() => validateDevelopmentResult(invalid, commit));
  }
});
