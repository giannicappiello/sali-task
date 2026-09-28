import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export function browserUrl(value) {
  const url = new URL(value);
  if (url.origin !== 'https://workspace.progre.it' || url.username || url.password) throw new Error('Destinazione browser non consentita.');
  return url.href;
}

export async function verifyBrowser(config, operation, check, chromium, bootstrap) {
  const { url, steps } = operation.payload;
  browserUrl(url);
  if (!/^[a-f0-9-]{36}$/i.test(operation.user_id)) throw new Error('Profilo browser non valido.');
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: false, serviceWorkers: 'block' });
    if (bootstrap) await context.addInitScript(({ storageKey, session }) => {
      if (location.origin === 'https://workspace.progre.it') localStorage.setItem(storageKey, JSON.stringify(session));
    }, bootstrap);
    const page = await context.newPage();
    // Keep navigations in Workspace, including redirects and popup destinations.
    await context.route('**/*', async route => {
      const request = route.request();
      if (request.isNavigationRequest()) {
        try { browserUrl(request.url()); } catch { return route.abort(); }
      }
      return route.continue();
    });
    await check();
    await page.goto(browserUrl(url), { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.locator('body').waitFor();
    await page.locator('html[data-workspace-user-id]').waitFor({ timeout: 20000 }).catch(() => { throw new Error('Accesso richiesto nel profilo browser isolato. Aprire il browser di collaudo e accedere con il proprio utente Workspace.'); });
    const identity = await page.locator('html').getAttribute('data-workspace-user-id');
    if (identity !== operation.user_id) throw new Error('Il browser è autenticato con un altro utente. Nessuna azione eseguita.');
    const performed = [];
    for (const step of steps) {
      await check(); browserUrl(page.url());
      if (await page.locator('html').getAttribute('data-workspace-user-id') !== operation.user_id) throw new Error('Identità browser cambiata.');
      if (step.action === 'click') {
        const target = page.getByRole('button', { name: step.target, exact: true }).or(page.getByRole('link', { name: step.target, exact: true }));
        if (await target.count() !== 1) throw new Error('Pulsante/link assente o ambiguo: ' + step.target);
        await target.click({ timeout: 10000 });
      } else if (step.action === 'fill') {
        const target = page.getByLabel(step.target, { exact: true });
        if (await target.count() !== 1) throw new Error('Campo assente o ambiguo: ' + step.target);
        if (await target.getAttribute('type') === 'password') throw new Error('Le credenziali devono essere inserite personalmente nel profilo browser.');
        await target.fill(step.value, { timeout: 10000 });
      } else if (step.action === 'assertText') {
        await page.getByText(step.target, { exact: false }).first().waitFor({ state: 'visible', timeout: 10000 });
      } else throw new Error('Azione browser non consentita.');
      performed.push({ action: step.action, target: step.target });
    }
    browserUrl(page.url());
    const screenshot = await page.screenshot({ type: 'jpeg', quality: 50 });
    return { summary: `Browser: ${performed.length} azioni completate. Pagina finale: ${page.url()}.`, url: page.url(), title: await page.title(), text: (await page.locator('body').innerText()).slice(0, 24000), actions: performed, screenshot: `data:image/jpeg;base64,${screenshot.toString('base64')}`, observedAt: new Date().toISOString() };
  } finally { await browser.close(); }
}

export async function executeDatabase(config, operation, check, execute) {
  const repo = config.repositories.workspace;
  if (!config.supabaseExecutable || !repo?.path) throw new Error('CLI database non configurata sul coordinatore.');
  const query = async sql => {
    await check();
    return JSON.parse((await execute(config.supabaseExecutable, ['db', 'query', '--linked', sql, '--output', 'json'], { cwd: repo.path, timeout: 90000, maxBytes: 1000000 })).toString());
  };
  if (operation.payload.operation === 'schema') {
    const result = await query("select table_name,column_name,data_type from information_schema.columns where table_schema='public' order by table_name,ordinal_position");
    const functions = await query("select p.proname as name,pg_get_function_identity_arguments(p.oid) as arguments from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' order by p.proname");
    return { summary: 'Schema e firme RPC letti dal database collegato.', columns: result.rows, functions: functions.rows, observedAt: new Date().toISOString() };
  }
  const { commit, files } = operation.payload;
  if (!/^[a-f0-9]{40}$/.test(commit || '') || !Array.isArray(files) || !files.length || files.length > 20 || files.some(path => !/^supabase\/migrations\/\d{14}_[a-zA-Z0-9_-]+\.sql$/.test(path))) throw new Error('Revisione migrazioni non valida.');
  const remote = (await execute('git', ['remote', 'get-url', 'origin'], { cwd: repo.path })).toString().trim();
  if (remote !== repo.expectedRemote) throw new Error('Repository database diverso da quello configurato.');
  await execute('git', ['fetch', '--no-tags', 'origin', 'main'], { cwd: repo.path, timeout: 90000 });
  await execute('git', ['merge-base', '--is-ancestor', commit, 'origin/main'], { cwd: repo.path });
  const results = [];
  for (const path of [...files].sort()) {
    await check();
    const version = path.split('/').pop().slice(0, 14);
    const existing = await query(`select version from supabase_migrations.schema_migrations where version='${version}'`);
    if (existing.rows?.length) { results.push({ path, status: 'already_applied' }); continue; }
    const sql = await execute('git', ['show', `${commit}:${path}`], { cwd: repo.path, maxBytes: 1000000 });
    const currentSql = await execute('git', ['show', `origin/main:${path}`], { cwd: repo.path, maxBytes: 1000000 });
    if (!sql.equals(currentSql)) throw new Error('Migrazione cambiata dopo il lavoro verificato: ' + path);
    const directory = join(config.outputDirectory, operation.id);
    await mkdir(directory, { recursive: true });
    const localFile = join(directory, `${version}.sql`);
    await writeFile(localFile, sql);
    await check();
    await execute(config.supabaseExecutable, ['db', 'query', '--linked', '--file', localFile], { cwd: repo.path, timeout: 90000 });
    try {
      await execute(config.supabaseExecutable, ['migration', 'repair', version, '--status', 'applied', '--linked'], { cwd: repo.path, timeout: 60000 });
    } catch { throw new Error(`Migrazione ${version} eseguita, ma registro non aggiornato. Non ripetere: riconciliare il registro.`); }
    results.push({ path, status: 'applied' });
  }
  await query("notify pgrst, 'reload schema'");
  return { summary: `Migrazioni verificate nel registro: ${results.length}. Nessun’altra migrazione pendente applicata.`, migrations: results, commit };
}

export async function runRuntimeOperation(config, api, execute, dependencies = {}) {
  const { operation } = await api({ action: 'runtime_claim' });
  if (!operation) return false;
  const identity = { id: operation.id, leaseToken: operation.lease_token };
  const check = () => api({ action: 'runtime_check', ...identity });
  try {
    await check();
    const bootstrap = operation.capability === 'browser' ? await api({ action: 'runtime_session', ...identity }) : null;
    if (operation.payload.operation === 'browser_login') operation.payload = { url: 'https://workspace.progre.it/activities/dashboard', steps: [] };
    const result = operation.capability === 'browser'
      ? await verifyBrowser(config, operation, check, dependencies.chromium || (await import('playwright')).chromium, bootstrap)
      : await executeDatabase(config, operation, check, execute);
    await api({ action: 'runtime_finish', ...identity, succeeded: true, result });
  } catch (error) {
    await api({ action: 'runtime_finish', ...identity, succeeded: false, error: String(error.message).slice(0, 1800) });
  }
  return true;
}
