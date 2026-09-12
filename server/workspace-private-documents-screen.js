export const PRIVATE_DOCUMENTS_SCREEN = {
  codice: 'workspace.documents.private', nome: 'Articoli, lotti e certificati',
  descrizione: 'Archivio documenti private, lotti e certificati conservati sul NAS.',
  percorso: '/documentation/private', provider: 'workspace', area: 'documentale',
  chiave_componente: 'private-documents', icona: 'file-archive',
  attiva: true, protetta: false, ordine: 100,
  metadati: { required_permissions: ['documentation.private.view'] },
};

// Register once. Existing assignments, names and deactivation remain user-owned.
export async function ensurePrivateDocumentsScreen(db) {
  const definition = PRIVATE_DOCUMENTS_SCREEN;
  const existing = await db.from('workspace_schermate').select('codice')
    .eq('percorso', definition.percorso).maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data) return;
  const deleted = await db.from('workspace_catalog_deletions').select('code')
    .eq('kind', 'screen').eq('code', definition.codice).maybeSingle();
  if (deleted.error) throw deleted.error;
  if (deleted.data) return;
  const inserted = await db.from('workspace_schermate').upsert(definition,
    { onConflict: 'codice', ignoreDuplicates: true }).select('codice');
  if (inserted.error) throw inserted.error;
  if (!inserted.data?.length) return;
  const module = await db.from('workspace_moduli').select('codice')
    .eq('codice', 'progremes_formule').maybeSingle();
  if (module.error) throw module.error;
  if (!module.data) return;
  const linked = await db.from('workspace_moduli_schermate').upsert({
    modulo_codice: module.data.codice, schermata_codice: definition.codice,
    ordine: 10, predefinita: false, visibile_menu: true,
  }, { onConflict: 'modulo_codice,schermata_codice', ignoreDuplicates: true });
  if (linked.error) throw linked.error;
}
