import test from 'node:test';
import assert from 'node:assert/strict';
import { validateDevelopmentResult } from './development-jobs.js';

test('successful development completion requires matching source, checks and review commit', () => {
  const commit = 'a'.repeat(40);
  const valid = { baseCommit: commit, published: false, checks: [{ succeeded: true }], edits: [{ path: 'a.js' }], revision: { branch: 'codex/ai-00000000-0000-4000-8000-000000000000', commit: 'b'.repeat(40), published: false } };
  assert.doesNotThrow(() => validateDevelopmentResult(valid, commit));
  for (const invalid of [{ ...valid, baseCommit: 'c'.repeat(40) }, { ...valid, checks: [] }, { ...valid, checks: [{ succeeded: false }] }, { ...valid, revision: null }, { ...valid, published: true }, { ...valid, edits: [] }]) {
    assert.throws(() => validateDevelopmentResult(invalid, commit));
  }
});
