const key = value => String(value || '').trim().toUpperCase();

export function articleNasDirectory(files, articleCode) {
  const candidates = new Set();
  const productionRoots = new Set();
  for (const file of files.filter(f => f.active && !f.path.split('/').some(p => /^(?:@Recycle|#recycle|\$RECYCLE\.BIN)$/i.test(p)))) {
    const parts = file.path.split('/');
    const production = parts.findIndex(p => key(p) === 'PRODUZIONE');
    if (production < 0) continue;
    productionRoots.add(parts.slice(0, production + 1).join('/'));
    for (let i = production + 1; i < parts.length - 1; i++) {
      if (key(parts[i]) === key(articleCode)) candidates.add(parts.slice(0, i + 1).join('/'));
    }
  }
  const ordered = [...candidates].sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b));
  const root = [...productionRoots].sort()[0] || 'Produzione';
  return { directory: ordered[0] || `${root}/${articleCode}`,
    notice: ordered.length ? '' : `Nessun file indicizzato nella cartella del prodotto ${articleCode}. Se hai aggiunto file sul NAS, aggiorna l’archivio.` };
}
