import test from 'node:test';
import { Buffer } from 'node:buffer';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { publishVerifiedRevision, verifyWorkspaceDeployment } from '../../hosting/ai-development/publisher.mjs';
import { validatePublishedResult } from './development-jobs.js';
import { run } from '../../hosting/ai-development/worker.mjs';
import { randomUUID } from 'node:crypto';

const execute = async (file, args, options) => execFileSync(file, args, { ...options, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'ai-publish-'));
  const remote = join(root, 'remote.git'); const local = join(root, 'local');
  execFileSync('git', ['init', '--bare', '-q', remote]);
  execFileSync('git', ['clone', '-q', remote, local], { stdio: 'pipe' });
  const git = (...args) => execFileSync('git', args, { cwd: local, encoding: 'utf8', stdio: 'pipe' }).trim();
  git('config', 'user.name', 'AI test'); git('config', 'user.email', 'test@example.invalid'); git('checkout', '-b', 'main');
  await writeFile(join(local, 'file.md'), 'before'); git('add', '.'); git('commit', '-qm', 'base'); git('push', '-q', 'origin', 'main');
  const baseCommit = git('rev-parse', 'HEAD');
  await writeFile(join(local, 'file.md'), 'after'); git('add', '.'); git('commit', '-qm', 'verified');
  const commit = git('rev-parse', 'HEAD');
  const result = { baseCommit, published: false, edits: [{ path: 'file.md', content: 'after' }], checks: [{ succeeded: true }], revision: { commit, branch: `codex/ai-${randomUUID()}`, published: false } };
  return { root, git, repo: { path: local, expectedRemote: remote, publishEnabled: true }, result };
}
test('verified publication fast-forwards main, preserves checkout and reconciles repeated calls', async () => {
  const { repo, result, git } = await fixture();
  await writeFile(join(repo.path, 'file.md'), 'unrelated local work');
  const published = await publishVerifiedRevision(repo, result, execute);
  assert.equal(published.mainCommit, result.revision.commit);
  assert.equal(git('ls-remote', 'origin', 'refs/heads/main').split(/\s/)[0], result.revision.commit);
  assert.equal(git('diff', '--name-only'), 'file.md');
  assert.equal((await publishVerifiedRevision(repo, result, execute)).mainCommit, result.revision.commit);
});
test('publication rejects untested content and a main that changed since tests', async () => {
  const { repo, result, git } = await fixture();
  await assert.rejects(publishVerifiedRevision(repo, { ...result, edits: [{ path: 'file.md', content: 'different' }] }, execute), /contenuto/);
  git('checkout', '-q', '-b', 'other', result.baseCommit);
  await writeFile(join(repo.path, 'other.md'), 'concurrent'); git('add', '.'); git('commit', '-qm', 'concurrent'); git('push', 'origin', 'HEAD:main');
  await assert.rejects(publishVerifiedRevision(repo, result, execute), /Main è cambiato/);
  assert.equal(git('ls-remote', 'origin', 'refs/heads/main').split(/\s/)[0], git('rev-parse', 'HEAD'));
});
test('production completion requires exact commit and current alias, not READY alone', async () => {
  const sha = 'a'.repeat(40);
  const repo = { path: '.', deployment: { project: 'sali-task', scope: 'progre1', alias: 'https://workspace.progre.it' } };
  let aliasUrl = 'old.vercel.app';
  const cli = async (_file, args) => Buffer.from(JSON.stringify(args.includes('list') ? { deployments: [{ name: 'sali-task', meta: { githubCommitSha: sha, githubCommitRef: 'main' }, target: 'production', state: 'READY', url: 'new.vercel.app' }] } : { id: 'deployment', url: aliasUrl, readyState: 'READY', aliases: ['workspace.progre.it'] }));
  await assert.rejects(verifyWorkspaceDeployment(repo, sha, cli, { attempts: 1 }), /non ancora verificata/);
  aliasUrl = 'new.vercel.app';
  assert.equal((await verifyWorkspaceDeployment(repo, sha, cli, { attempts: 1 })).stage, 'production_ready');
});
test('finish cannot claim deployment without publication authorization and evidence', () => {
  const result = { baseCommit: 'a'.repeat(40), published: true, edits: [{ path: 'a.js' }], checks: [{ succeeded: true }], revision: { branch: `codex/ai-${randomUUID()}`, commit: 'b'.repeat(40), published: false }, publication: { branch: 'main', mainCommit: 'b'.repeat(40), stage: 'production_ready', deploymentState: 'READY', productionUrl: 'https://workspace.progre.it' } };
  const job = { source_commit: result.baseCommit, publish_requested: true, repository: 'workspace' };
  assert.doesNotThrow(() => validatePublishedResult(result, job));
  assert.throws(() => validatePublishedResult(result, { ...job, publish_requested: false }));
  assert.throws(() => validatePublishedResult({ ...result, publication: { ...result.publication, stage: 'main_published' } }, job));
});
test('worker resumes a tested MES publication without regenerating code or updating the server', async () => {
  const { repo, result, root } = await fixture(); const job = { id: randomUUID(), lease_token: randomUUID(), repository: 'mes', publish_requested: true, result };
  let finished; let checkpoints = 0;
  await run({ workspaceUrl: 'https://workspace.example.invalid', token: 'a'.repeat(64), outputDirectory: join(root, 'results'), repositories: { mes: { ...repo, image: 'unused', checks: [['unused']] } } }, { once: true, transport: async (_url, request) => {
    const body = JSON.parse(request.body);
    if (body.action === 'claim') return Response.json({ job });
    if (body.action === 'checkpoint') checkpoints++;
    else if (body.action === 'finish') finished = body;
    else assert.fail(`Unexpected worker action ${body.action}`);
    return Response.json({});
  } });
  assert.equal(checkpoints, 2); assert.equal(finished.succeeded, true, finished.error);
  assert.equal(finished.result.published, true);
  assert.equal(finished.result.publication.serverUpdateRequired, true);
});
