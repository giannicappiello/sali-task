import { requireAdmin } from './mexal/lib/auth.js';

export async function deliverCatalogDeletions(admin, fetcher = fetch) {
  const { data, error } = await admin.from('workspace_catalog_deletions').select('kind,code,external_code');
  if (error) throw error;
  const entries = (data || []).filter(row => row.external_code);
  for (let offset = 0; offset < entries.length; offset += 100) {
    const batch = entries.slice(offset, offset + 100);
    const response = await fetcher(new URL('/api/workspace/modules/deletions', process.env.PROGREMES_URL), {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Workspace-Secret': process.env.PROGREMES_INTEGRATION_SECRET },
      body: JSON.stringify({ codes: batch.filter(r => r.kind === 'module').map(r => r.external_code), screens: batch.filter(r => r.kind === 'screen').map(r => r.external_code) }),
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error(`MES non ha confermato la cancellazione (${response.status}).`);
  }
  return { synchronized: true };
}

export async function syncDeletedWorkspaceCatalog(req, admin) {
  await requireAdmin(req, admin);
  try { return await deliverCatalogDeletions(admin); }
  catch { return { synchronized: false, message: 'Cancellazione salvata in Workspace. Allineamento MES in attesa: riprova dopo aver aggiornato o riavviato MES.' }; }
}
