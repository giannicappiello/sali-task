/* global process */
import { dirname, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

export async function publishVerifiedRevision(repo, result, execute) {
  const commit = result?.revision?.commit;
  const base = result?.baseCommit;
  if (!repo?.publishEnabled || !repo.expectedRemote || !/^[a-f0-9]{40}$/.test(commit || '') || !/^[a-f0-9]{40}$/.test(base || '') ||
      !result.checks?.length || result.checks.some(check => check.succeeded !== true)) throw new Error('Pubblicazione priva di configurazione o verifiche riuscite.');
  const git = async args => (await execute('git', ['-c', 'core.hooksPath=/dev/null', ...args], { cwd: repo.path, env: { GIT_TERMINAL_PROMPT: '0' }, timeout: 120000 })).toString().trim();
  if (await git(['remote', 'get-url', 'origin']) !== repo.expectedRemote) throw new Error('Repository di pubblicazione diverso da quello autorizzato.');
  if (await git(['rev-parse', `${commit}^`]) !== base) throw new Error('Commit non collegato alla revisione verificata.');
  if (!Array.isArray(result.edits) || !result.edits.length) throw new Error('Nessuna modifica verificata da pubblicare.');
  const changed = (await execute('git', ['diff-tree', '--no-commit-id', '--name-only', '-r', '-z', base, commit], { cwd: repo.path })).toString().split('\0').filter(Boolean).sort();
  if (JSON.stringify(changed) !== JSON.stringify(result.edits.map(edit => edit.path).sort())) throw new Error('Il commit contiene modifiche diverse da quelle verificate.');
  for (const edit of result.edits) {
    const actual = (await execute('git', ['show', `${commit}:${edit.path}`], { cwd: repo.path })).toString();
    if (actual !== edit.content) throw new Error('Il contenuto del commit non coincide con quello testato.');
  }
  await git(['fetch', '--no-tags', 'origin', 'main']);
  const remote = await git(['rev-parse', 'refs/remotes/origin/main']);
  if (remote !== commit) {
    // No force push, merge, checkout, hooks or execution of generated code on the host.
    if (remote !== base) throw new Error('Main è cambiato dopo i test. Rigenerare la modifica sulla nuova revisione e rieseguire i test; nessun file remoto sovrascritto.');
    let pushError;
    try { await git(['push', 'origin', `${commit}:refs/heads/main`]); } catch (error) { pushError = error; }
    const readback = await git(['ls-remote', 'origin', 'refs/heads/main']);
    if (readback.split(/\s/)[0] !== commit) throw pushError || new Error('Commit remoto non verificato dopo la pubblicazione.');
  }
  return { stage: 'main_published', mainCommit: commit, branch: 'main', verifiedAt: new Date().toISOString() };
}

export async function verifyWorkspaceDeployment(repo, commit, execute, { attempts = 40, pause = delay } = {}) {
  const cfg = repo.deployment;
  if (!cfg?.project || !cfg.scope || !cfg.alias) throw new Error('Verifica produzione Vercel non configurata.');
  const npx = join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npx-cli.js');
  for (let attempt = 0; attempt < attempts; attempt++) {
    const raw = await execute(process.execPath, [npx, '--yes', 'vercel@59.26.0', 'list', cfg.project, '--scope', cfg.scope,
      '--environment', 'production', '--meta', `githubCommitSha=${commit}`, '--json', '--non-interactive'], { cwd: repo.path, timeout: 60000 });
    const parsed = JSON.parse(raw.toString());
    const rows = Array.isArray(parsed) ? parsed : parsed.deployments || [];
    const deployment = rows.find(row => row.meta?.githubCommitSha === commit && row.name === cfg.project && row.meta?.githubCommitRef === 'main' && row.target === 'production');
    if (deployment && ['ERROR', 'CANCELED'].includes(deployment.state || deployment.readyState)) throw new Error(`Main pubblicato, deployment Vercel ${deployment.state || deployment.readyState}.`);
    if (deployment && (deployment.state || deployment.readyState) === 'READY') {
      const inspection = JSON.parse((await execute(process.execPath, [npx, '--yes', 'vercel@59.26.0', 'inspect', cfg.alias, '--scope', cfg.scope, '--json', '--non-interactive'], { cwd: repo.path, timeout: 60000 })).toString());
      if (inspection.url === deployment.url && inspection.readyState === 'READY' && inspection.aliases?.includes(new URL(cfg.alias).hostname)) {
        return { stage: 'production_ready', mainCommit: commit, branch: 'main', deploymentId: inspection.id,
          url: `https://${deployment.url}`, productionUrl: cfg.alias, deploymentState: 'READY', verifiedAt: new Date().toISOString() };
      }
    }
    if (attempt + 1 < attempts) await pause(15000);
  }
  throw new Error('Main pubblicato; produzione non ancora verificata READY. Verificare il deployment, senza ripetere la modifica.');
}
