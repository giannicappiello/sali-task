export const PRINTER_SCREEN = {
  codice: 'progremes.Stampanti', nome: 'Stampanti',
  descrizione: 'Configurazione stampanti PRODUZIONE, SEGRETERIA, UFFICIO e MAGAZZINO e registro stampe MES.',
  percorso: '/produzione/progremes.Stampanti', provider: 'progremes', area: 'configurazioni',
  chiave_componente: null, icona: 'settings',
  attiva: true, protetta: false, ordine: 305,
  metadati: { external_code: 'Stampanti', external_module_code: 'Impostazioni',
    external_route: '/impostazioni/stampanti', group: 'Impostazioni', catalog_source: 'workspace_seed' },
};

// Register once. Existing assignments, names and deactivation remain user-owned.
export async function ensurePrinterScreen(db) {
  const definition = PRINTER_SCREEN;
  const existing = await db.from('workspace_schermate').select('codice')
    .eq('codice', definition.codice).maybeSingle();
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
    .eq('codice', 'impostazioni_mes').maybeSingle();
  if (module.error) throw module.error;
  if (!module.data) return;
  const linked = await db.from('workspace_moduli_schermate').upsert({
    modulo_codice: module.data.codice, schermata_codice: definition.codice,
    ordine: 60, predefinita: false, visibile_menu: true,
  }, { onConflict: 'modulo_codice,schermata_codice', ignoreDuplicates: true });
  if (linked.error) throw linked.error;
}
