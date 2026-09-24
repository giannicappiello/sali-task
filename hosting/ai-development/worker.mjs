/* global process, Buffer */
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { safeDevelopmentPath } from './worker-paths.mjs';

const MAX_BYTES = 64 * 1024 * 1024;
const sha = value => createHash('sha256').update(value).digest('hex');

function execute(file, args, { cwd, input, env, timeout = 30000, maxBytes = MAX_BYTES } = {}) {
  return new Promise((done, reject) => {
    const child = spawn(file, args, { cwd, env: env ? { ...process.env, ...env } : process.env, windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
    const stdout = []; const stderr = []; let count = 0; let failure;
    const timer = setTimeout(() => { failure = new Error('Processo fidato scaduto.'); child.kill(); }, timeout);
    for (const [stream, destination] of [[child.stdout, stdout], [child.stderr, stderr]]) stream.on('data', chunk => {
      count += chunk.length;
      if (count > maxBytes) { failure = new Error('Output troppo grande.'); child.kill(); }
      else destination.push(chunk);
    });
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => {
      clearTimeout(timer);
      if (failure || code !== 0) reject(failure || new Error(Buffer.concat(stderr).toString().slice(0, 2000) || `Processo terminato: ${code}`));
      else done(Buffer.concat(stdout));
    });
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}

export async function snapshot(repository, ref = 'HEAD') {
  if (!/^(?:HEAD|refs\/remotes\/origin\/main)$/.test(ref)) throw new Error('Riferimento sorgente non consentito.');
  const baseCommit = (await execute('git', ['rev-parse', '--verify', `${ref}^{commit}`], { cwd: repository })).toString().trim();
  if (!/^[a-f0-9]{40}$/.test(baseCommit)) throw new Error('Revisione Git non valida.');
  const entries = (await execute('git', ['ls-tree', '-rz', baseCommit], { cwd: repository })).toString().split('\0').filter(Boolean);
  const selected = entries.map(entry => /^(100644|100755) blob ([a-f0-9]{40})\t(.+)$/.exec(entry)).filter(match => match && safeDevelopmentPath(match[3]));
  if (selected.length > 10000) throw new Error('Repository oltre i limiti del servizio.');
  const data = await execute('git', ['cat-file', '--batch'], { cwd: repository, input: selected.map(match => match[2]).join('\n') + '\n', timeout: 120000 });
  const files = {}; let position = 0;
  for (const match of selected) {
    const end = data.indexOf(10, position);
    const header = /^([a-f0-9]{40}) blob (\d+)$/.exec(data.subarray(position, end).toString());
    if (!header || header[1] !== match[2]) throw new Error('Archivio Git non coerente.');
    const size = Number(header[2]);
    if (!Number.isSafeInteger(size) || end + 1 + size >= data.length) throw new Error('Archivio Git incompleto.');
    files[match[3]] = data.subarray(end + 1, end + 1 + size).toString('base64');
    position = end + 2 + size;
  }
  return { baseCommit, files };
}

export function applyEdits(files, edits) {
  const changed = { ...files };
  if (!Array.isArray(edits) || edits.length === 0 || edits.length > 100) throw new Error('Nessuna modifica verificabile o troppe modifiche.');
  const seen = new Set();
  for (const edit of edits) {
    if (!safeDevelopmentPath(edit.path) || seen.has(edit.path) || typeof edit.content !== 'string' || edit.content.length > 200000) throw new Error('Modifica non valida.');
    seen.add(edit.path);
    const previous = Object.hasOwn(files, edit.path) ? sha(Buffer.from(files[edit.path], 'base64')) : null;
    if (previous !== edit.previousSha256) throw new Error('La revisione originale non coincide: ' + edit.path);
    if (/(^|\/)(package(-lock)?\.json|pnpm-lock\.yaml|yarn\.lock|.*\.csproj|NuGet\.Config)$/i.test(edit.path)) throw new Error('Dipendenze modificate: preparare e approvare un nuovo ambiente di verifica.');
    changed[edit.path] = Buffer.from(edit.content).toString('base64');
  }
  return changed;
}

export function verifyDependencyManifest(files, manifest) {
  if (!manifest || !Object.keys(manifest).length) throw new Error('Ambiente privo di impronta delle dipendenze approvate.');
  for (const [path, expected] of Object.entries(manifest)) {
    if (!Object.hasOwn(files, path) || !/^[a-f0-9]{64}$/.test(expected) || sha(Buffer.from(files[path], 'base64')) !== expected)
      throw new Error('Dipendenze diverse dall’ambiente verificato: ' + path);
  }
}

export async function createReviewBranch(repository, source, edits, jobId, outputRoot) {
  if (!/^[a-f0-9-]{36}$/.test(jobId)) throw new Error('Identificativo lavoro non valido.');
  applyEdits(source.files, edits);
  const branch = 'codex/ai-' + jobId;
  // A separate index writes Git objects only. Generated files and hooks never run on Windows.
  const env = { GIT_INDEX_FILE: join(outputRoot, jobId + '.index'), GIT_AUTHOR_NAME: 'Workspace AI', GIT_AUTHOR_EMAIL: 'ai@workspace.invalid', GIT_COMMITTER_NAME: 'Workspace AI', GIT_COMMITTER_EMAIL: 'ai@workspace.invalid' };
  const git = (args, input) => execute('git', args, { cwd: repository, input, env });
  await git(['read-tree', source.baseCommit]);
  for (const edit of edits) {
    const blob = (await git(['hash-object', '-w', '--stdin'], edit.content)).toString().trim();
    const entry = (await git(['ls-tree', source.baseCommit, '--', edit.path])).toString();
    const mode = entry.startsWith('100755 ') ? '100755' : '100644';
    await git(['update-index', '--add', '--cacheinfo', `${mode},${blob},${edit.path}`]);
  }
  const tree = (await git(['write-tree'])).toString().trim();
  const commit = (await git(['commit-tree', tree, '-p', source.baseCommit], `Modifica AI verificata · ${jobId}\n`)).toString().trim();
  await git(['update-ref', `refs/heads/${branch}`, commit, '0000000000000000000000000000000000000000']);
  return { branch, commit, published: false };
}

export async function run(config, { transport = fetch, once = false } = {}) {
  const endpoint = new URL('/api/ai/worker', config.workspaceUrl);
  if (endpoint.protocol !== 'https:') throw new Error('Workspace deve usare HTTPS.');
  if (!/^[a-f0-9]{64}$/.test(config.token || '')) throw new Error('Credenziale di associazione mancante.');
  const outputRoot = resolve(config.outputDirectory);
  await mkdir(outputRoot, { recursive: true });
  const api = async body => {
    const response = await transport(endpoint, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(210000),
      headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const result = await response.json();
    if (!response.ok || result.success === false) throw new Error(result.error || `Workspace: ${response.status}`);
    return result;
  };
  for (;;) {
    let job;
    try { ({ job } = await api({ action: 'claim' })); }
    catch (error) { process.stderr.write(`${new Date().toISOString()} Collegamento: ${error.message}\n`); await delay(30000); continue; }
    if (!job) { if (once) return; await delay(15000); continue; }
    const identity = { jobId: job.id, leaseToken: job.lease_token };
    let leaseLost = false;
    const heartbeat = setInterval(() => { api({ action: 'heartbeat', ...identity }).catch(() => { leaseLost = true; }); }, 45000);
    try {
      if (!/^[a-f0-9-]{36}$/.test(job.id)) throw new Error('Identificativo lavoro non valido.');
      const repo = config.repositories?.[job.repository];
      if (!repo?.path || !repo.image || !Array.isArray(repo.checks) || !repo.checks.length) throw new Error('Repository o ambiente di verifica non configurato sul PC.');
      if (repo.sourceRef === 'refs/remotes/origin/main') {
        const remote = (await execute('git', ['remote', 'get-url', 'origin'], { cwd: repo.path })).toString().trim();
        if (!repo.expectedRemote || remote !== repo.expectedRemote) throw new Error('Repository remoto diverso da quello configurato.');
        await execute('git', ['fetch', '--no-tags', 'origin', 'main'], { cwd: repo.path, timeout: 120000 });
      }
      const source = await snapshot(repo.path, repo.sourceRef || 'HEAD');
      verifyDependencyManifest(source.files, repo.dependencyManifest);
      const index = Object.keys(source.files).filter(path => /\.(jsx?|tsx?|json|cs|razor|css|sql|md|yml|yaml)$/.test(path));
      const supplied = {};
      let generated;
      let checks = [];
      let testFailure = null;
      const attempts = [];
      for (let round = 0; round < 4; round++) {
        if (leaseLost) throw new Error('Sessione worker persa.');
        generated = await api({ action: 'generate', ...identity, source: { baseCommit: source.baseCommit, index, files: supplied, testFailure } });
        for (const path of generated.requiredFiles || []) {
          if (!index.includes(path)) throw new Error('File richiesto fuori dalla revisione.');
          const content = Buffer.from(source.files[path], 'base64').toString('utf8');
          if (content.includes('\u0000') || content.length > 200000) throw new Error('File non testuale o troppo grande: ' + path);
          supplied[path] = content;
        }
        if (generated.requiredFiles?.length) continue;
        const files = applyEdits(source.files, generated.edits);
        checks = [];
        for (const command of repo.checks) {
        if (leaseLost) throw new Error('Sessione worker persa.');
        const raw = await execute('wsl', ['-d', config.distribution, '-u', 'aiworker', '--cd', '/home/aiworker', '--exec', 'env', 'XDG_RUNTIME_DIR=/run/user/1000', 'DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus', 'python3', '/opt/assistenteai/run_payload.py'], {
          input: JSON.stringify({ files, image: repo.image, command, timeout: 600 }), timeout: 650000, maxBytes: 2000000,
        });
        const check = JSON.parse(raw.toString()); checks.push(check);
        if (!check.succeeded) break;
        }
        attempts.push({ round: round + 1, checks });
        if (checks.length === repo.checks.length && checks.every(check => check.succeeded)) break;
        testFailure = { edits: generated.edits, output: checks.map(check => check.output || '').join('\n').slice(-30000) };
      }
      if (generated.requiredFiles?.length) throw new Error('Servono altri sorgenti: limite dei cicli raggiunto.');
      const passed = checks.length === repo.checks.length && checks.every(check => check.succeeded);
      if (leaseLost) throw new Error('Sessione worker persa prima della registrazione del risultato.');
      await api({ action: 'heartbeat', ...identity });
      const revision = passed ? await createReviewBranch(repo.path, source, generated.edits, job.id, outputRoot) : null;
      const result = { baseCommit: source.baseCommit, summary: generated.summary, edits: generated.edits, checks, attempts, revision, published: false };
      const path = join(outputRoot, job.id + '.json');
      await writeFile(path, JSON.stringify(result, null, 2), { flag: 'wx' });
      await api({ action: 'finish', ...identity, succeeded: passed, result,
        error: passed ? null : 'Compilazione o test non riusciti. Modifiche non pubblicate.' });
    } catch (error) {
      await api({ action: 'finish', ...identity, succeeded: false, error: error.message }).catch(failure => process.stderr.write(`Esito da riconciliare per ${job.id}: ${failure.message}\n`));
    } finally { clearInterval(heartbeat); }
    if (once) return;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href && process.argv[2]) {
  const raw = process.argv[2] === '-' ? await new Promise((resolveInput, reject) => {
    let value = ''; process.stdin.setEncoding('utf8'); process.stdin.on('data', chunk => { value += chunk; if (value.length > 100000) { reject(new Error('Configurazione troppo grande.')); process.stdin.destroy(); } }); process.stdin.on('end', () => resolveInput(value)); process.stdin.on('error', reject);
  }) : await readFile(resolve(process.argv[2]), 'utf8');
  run(JSON.parse(raw.replace(/^\uFEFF/, ''))).catch(error => { process.stderr.write(error.message + '\n'); process.exitCode = 1; });
}
