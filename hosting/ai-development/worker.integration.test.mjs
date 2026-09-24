import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { run } from './worker.mjs';

const digest = value => createHash('sha256').update(value).digest('hex');
for (const scenario of ['pass', 'fail', 'repair']) test(`real isolated worker: ${scenario}`, { skip: process.env.AI_VERIFY_WSL !== '1', timeout: 180000 }, async () => {
  const passes = scenario !== 'fail';
  let generations = 0;
  const root = await mkdtemp(join(tmpdir(), 'assistenteai-flow-'));
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true }).trim();
  git('init', '-q'); git('config', 'user.name', 'AI test'); git('config', 'user.email', 'test@example.invalid');
  await writeFile(join(root, 'value.mjs'), 'export default 3;');
  await writeFile(join(root, 'package-lock.json'), '{}');
  git('add', '.'); git('commit', '-qm', 'Test fixture');
  const initial = git('rev-parse', 'HEAD');
  const job = { id: randomUUID(), lease_token: randomUUID(), repository: 'workspace' };
  let finish;
  await run({ workspaceUrl: 'https://workspace.example.invalid', token: 'a'.repeat(64), outputDirectory: join(root, 'results'), distribution: 'Ubuntu-24.04', repositories: { workspace: {
    path: root, image: 'docker.io/library/node@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6', dependencyManifest: { 'package-lock.json': digest('{}') },
    checks: [['node', '--input-type=module', '-e', "import assert from 'node:assert/strict'; import value from './value.mjs'; assert.equal(value,4);"]],
  } } }, { once: true, transport: async (_url, request) => {
    const body = JSON.parse(request.body);
    let result = {};
    if (body.action === 'claim') result = { job };
    else if (body.action === 'generate') {
      generations++;
      if (generations > 1) assert.ok(body.source.testFailure.output.includes('AssertionError'));
      result = { requiredFiles: [], summary: 'Fixture change', edits: [{ path: 'value.mjs', previousSha256: digest('export default 3;'), content: `export default ${passes && (scenario !== 'repair' || generations > 1) ? 4 : 5};` }] };
    }
    else if (body.action === 'finish') finish = body;
    else assert.equal(body.action, 'heartbeat');
    return Response.json(result);
  } });
  assert.equal(finish?.succeeded, passes, JSON.stringify(finish));
  assert.equal(git('rev-parse', 'HEAD'), initial);
  assert.equal(await readFile(join(root, 'value.mjs'), 'utf8'), 'export default 3;');
  if (passes) assert.equal(git('show', `${finish.result.revision.commit}:value.mjs`), 'export default 4;');
  else assert.equal(finish.result.revision, null);
  assert.equal(finish.result.published, false);
  assert.equal(generations, scenario === 'fail' ? 4 : scenario === 'repair' ? 2 : 1);
});
