import { isDirectProductCode } from '../../shared/directProductCatalog.js';

export function directWorkspaceProducts(rows) {
  return rows.filter(row => isDirectProductCode(row.codice_mexal || row.codice))
    .map(row => ({ ...row, codice: row.codice_mexal || row.codice }));
}

export async function loadDirectWorkspaceProducts(client) {
  const rows = [];
  for (let from = 0; ; from += 500) {
    const result = await client.from('prodotti').select('id,nome,codice,codice_mexal,brand,categoria')
      .eq('attivo_mexal', true)
      .or('codice_mexal.ilike.IT%,codice_mexal.ilike.MKT%,codice_mexal.ilike.IMP%,codice.ilike.IT%,codice.ilike.MKT%,codice.ilike.IMP%')
      .order('nome').order('id').range(from, from + 499);
    if (result.error) return { data: [], error: result.error };
    rows.push(...(result.data || []));
    if ((result.data || []).length < 500) return { data: directWorkspaceProducts(rows), error: null };
  }
}

export function projectsForCrmTask(projects, crmType, customerKey = '', phase = null) {
  return projects.filter(project => project.id === phase?.progetto_id ||
    ((!crmType || project.crm_tipo === crmType) && (!customerKey || project.crm_customer_key === customerKey)));
}
