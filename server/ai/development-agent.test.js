import test from 'node:test';
import { Buffer } from 'node:buffer';
import assert from 'node:assert/strict';
import { createSourceTools, safeDevelopmentPath } from './development-agent.js';
import { applyEdits, createReviewBranch, snapshot, verifyDependencyManifest } from '../../hosting/ai-development/worker.mjs';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';

test('development refuses credential paths, traversal and Windows alternate streams', () => {
  for (const path of ['../secret', '/etc/passwd', 'a/../../b', 'C:/file', 'a\\b', '.env.production', '.git/config', 'src/.npmrc', 'appsettings.Production.json', 'key.pem', 'a.js:stream']) assert.equal(safeDevelopmentPath(path), false, path);
  assert.equal(safeDevelopmentPath('src/pages/Home.jsx'), true);
});

test('source tools require exact occurrence and cannot overwrite an unread file', async () => {
  const state = createSourceTools({ index: ['a.js', 'b.js'], files: { 'a.js': 'one one two' } });
  assert.ok((await state.tools.SOURCE_REPLACE.execute({ path: 'b.js', oldText: 'one', newText: 'x' })).error);
  assert.ok((await state.tools.SOURCE_REPLACE.execute({ path: 'a.js', oldText: 'one', newText: 'x' })).error);
  assert.equal(state.edited.get('a.js'), 'one one two');
  assert.deepEqual(await state.tools.SOURCE_READ.execute({ path: 'b.js' }), { required: 'b.js' });
  assert.ok((await state.tools.SOURCE_CREATE.execute({ path: 'b.js', content: 'overwrite' })).error);
  await state.tools.SOURCE_REPLACE.execute({ path: 'a.js', oldText: 'two', newText: '$& literal' });
  assert.equal(state.edited.get('a.js'), 'one one $& literal');
});

test('worker rejects edits not bound to the exact original content', () => {
  assert.throws(() => applyEdits({ 'a.js': 'YQ==' }, [{ path: 'a.js', content: 'b', previousSha256: null }]), /revisione originale/);
  assert.throws(() => applyEdits({}, [{ path: 'package.json', content: '{}', previousSha256: null }]), /Dipendenze modificate/);
  assert.deepEqual(applyEdits({}, [{ path: 'src/new.js', content: 'a', previousSha256: null }]), { 'src/new.js': 'YQ==' });
});

test('worker refuses stale dependency images before running generated code', () => {
  const files = { 'package-lock.json': Buffer.from('approved').toString('base64') };
  const manifest = { 'package-lock.json': createHash('sha256').update('approved').digest('hex') };
  assert.doesNotThrow(() => verifyDependencyManifest(files, manifest));
  assert.throws(() => verifyDependencyManifest(files, {}), /impronta/);
  assert.throws(() => verifyDependencyManifest({}, manifest), /Dipendenze diverse/);
  assert.throws(() => verifyDependencyManifest({ 'package-lock.json': 'YQ==' }, manifest), /Dipendenze diverse/);
  assert.equal(safeDevelopmentPath('NuGet.Config'), false);
});

test('verified edits become a review branch without modifying the current checkout', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ai-review-test-'));
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true }).trim();
  git('init', '-q'); git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@example.invalid');
  await writeFile(join(root, 'a.js'), 'original'); await writeFile(join(root, 'keep.txt'), 'unchanged');
  git('add', '.'); git('commit', '-qm', 'Fixture');
  const source = await snapshot(root);
  const result = await createReviewBranch(root, source, [{ path: 'a.js', content: 'updated', previousSha256: createHash('sha256').update('original').digest('hex') }], randomUUID(), root);
  assert.equal(git('rev-parse', 'HEAD'), source.baseCommit);
  assert.equal(git('show', `${result.commit}:a.js`), 'updated');
  assert.equal(git('show', `${result.commit}:keep.txt`), 'unchanged');
  assert.equal(git('diff', '--name-only'), '');
  assert.equal(result.published, false);
});
