export async function archiveSheetFiles({ files, prepare, upload, confirm, onResult = () => {}, onProgress = () => {} }) {
  const results = [];
  for (const [index, file] of files.entries()) {
    let attempted = false;
    onProgress(`Salvataggio ${file.name} · ${index + 1}/${files.length}…`);
    onResult({ name: file.name, status: 'pending' });
    try {
      const prepared = await prepare(file);
      attempted = true;
      await upload(file, prepared);
      onProgress(`Verifica sul NAS: ${file.name}…`);
      const confirmed = await confirm(file, prepared);
      if (!confirmed.saved || confirmed.filename !== file.name) throw new Error('Conferma NAS non valida.');
      const result = { name: file.name, status: 'saved', url: confirmed.url };
      results.push(result); onResult(result);
    } catch (error) {
      const timeout = error.name === 'TimeoutError' || error.name === 'AbortError';
      const result = { name: file.name, status: attempted ? 'unconfirmed' : 'error', error: timeout ? 'Tempo di attesa esaurito. Controlla il collegamento al NAS e riprova.' : error.message };
      results.push(result); onResult(result);
    }
  }
  return results;
}
