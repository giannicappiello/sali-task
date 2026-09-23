import { requireAdmin } from './mexal/lib/auth.js';

export async function deliverCatalogDeletions(admin, fetcher = fetch, catalog = null) {
  const { data, error } = await admin.from('workspace_catalog_deletions').select('kind,code,external_code');
  if (error) throw error;
  const entries = (data || []).filter(row => row.external_code && ['module', 'screen'].includes(row.kind));
  if (!entries.length) return { synchronized: true, catalog, alreadyAbsent: 0 };
  // Tombstones survive upgrades. A retired (or already deleted) code must not
  // prevent importing unrelated new screens from the current MES catalog.
  if (!catalog) {
    const response = await fetcher(new URL('/api/workspace/modules', process.env.PROGREMES_URL), {
      headers: { 'X-Workspace-Secret': process.env.PROGREMES_INTEGRATION_SECRET },
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error(`Impossibile verificare il catalogo MES (${response.status}).`);
    catalog = await response.json();
  }
  if (!Array.isArray(catalog.modules)) throw new Error('Catalogo MES non valido: elenco moduli assente.');
  const screens = catalog.screens ?? catalog.pages ?? catalog.modules;
  if (!Array.isArray(screens)) throw new Error('Catalogo MES non valido: elenco schermate assente.');
  const key = value => String(value || '').trim().toLowerCase();
  const known = {
    module: new Map(catalog.modules.map(item => [key(item.code), item.code])),
    screen: new Map(screens.map(item => [key(item.code), item.code])),
  };
  const pending = entries.filter(row => known[row.kind].has(key(row.external_code)))
    .map(row => ({ ...row, external_code: known[row.kind].get(key(row.external_code)) }));
  for (let offset = 0; offset < pending.length; offset += 100) {
    const batch = pending.slice(offset, offset + 100);
    const response = await fetcher(new URL('/api/workspace/modules/deletions', process.env.PROGREMES_URL), {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Workspace-Secret': process.env.PROGREMES_INTEGRATION_SECRET },
      body: JSON.stringify({ codes: batch.filter(r => r.kind === 'module').map(r => r.external_code), screens: batch.filter(r => r.kind === 'screen').map(r => r.external_code) }),
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error(`MES non ha confermato l'allineamento del catalogo (${response.status}). Moduli: ${batch.filter(r => r.kind === 'module').map(r => r.external_code).join(', ') || 'nessuno'}; schermate: ${batch.filter(r => r.kind === 'screen').map(r => r.external_code).join(', ') || 'nessuna'}.`);
  }
  const deletedModules = new Set(entries.filter(row => row.kind === 'module').map(row => key(row.external_code)));
  const deletedScreens = new Set(entries.filter(row => row.kind === 'screen').map(row => key(row.external_code)));
  return { synchronized: true, alreadyAbsent: entries.length - pending.length, catalog: {
    ...catalog,
    modules: catalog.modules.filter(item => !deletedModules.has(key(item.code))),
    screens: screens.filter(item => !deletedScreens.has(key(item.code)) && !deletedModules.has(key(item.moduleCode ?? item.module_code ?? item.code))),
  } };
}

export async function syncDeletedWorkspaceCatalog(req, admin) {
  await requireAdmin(req, admin);
  try { return await deliverCatalogDeletions(admin); }
  catch { return { synchronized: false, message: 'Cancellazione salvata in Workspace. Allineamento MES in attesa: riprova dopo aver aggiornato o riavviato MES.' }; }
}
