// Supabase caps SELECT results. Page every source used to retain document links
// and filter the product query before paging, rather than filtering its first page.
export async function readAllDocumentRows(buildQuery) {
  const rows = [], size = 500;
  for (let offset = 0; ; offset += size) {
    const { data, error } = await buildQuery().range(offset, offset + size - 1);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < size) return rows;
  }
}

export function loadDocumentProductCatalog(admin) {
  return readAllDocumentRows(() => admin.from('prodotti')
    .select('id,nome,codice,codice_mexal').eq('attivo_mexal', true).eq('mostra_in_app', true)
    .or('codice_mexal.ilike.IT%,codice.ilike.IT%').order('id'));
}
