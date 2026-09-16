export const archiveDocuments = bundle => [...new Map([
  ...(bundle?.general || []), ...(bundle?.specific || []),
  ...(bundle?.materials || []).flatMap(material => material.documents),
].map(document => [document.externalId, document])).values()];

const safeName = value => [...String(value || '')].map(char => char.charCodeAt(0) < 32 ? '_' : char).join('').replace(/[\\/:*?"<>|]/g, '_').replace(/^\.+$/, '_').trim() || 'Documento';

export async function createDocumentArchive(documents, request, onProgress = () => {}) {
  const unique = [...new Map(documents.map(document => [document.externalId, document])).values()];
  if (!unique.length) throw new Error('Nessun documento da scaricare.');
  const { default: PizZip } = await import('pizzip');
  const zip = new PizZip(), usedNames = new Set();
  let completed = 0, bytes = 0;
  // Three files at a time; bounded chunks avoid the serverless response size limit.
  for (let start = 0; start < unique.length; start += 3) {
    const results = await Promise.allSettled(unique.slice(start, start + 3).map(async document => {
      const chunks = []; let offset = 0;
      do {
        const params = new URLSearchParams({ ...document.downloadContext, content: 'true', offset: String(offset) });
        const chunk = await request(`documents/${document.externalId}?${params}`);
        const data = Uint8Array.from(atob(chunk.base64), char => char.charCodeAt(0));
        bytes += data.length;
        if (bytes > 256 * 1024 * 1024) throw new Error('Archivio superiore a 256 MB: scaricare i documenti singolarmente.');
        if (chunk.nextOffset !== null && (!Number.isSafeInteger(chunk.nextOffset) || chunk.nextOffset <= offset)) throw new Error('Documento incompleto: download interrotto.');
        chunks.push(data); offset = chunk.nextOffset;
      } while (offset !== null);
      const data = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.length, 0));
      let position = 0; for (const chunk of chunks) { data.set(chunk, position); position += chunk.length; }
      return { document, data };
    }));
    for (const result of results) {
      if (result.status === 'rejected') throw result.reason;
      const { document, data } = result.value;
      const base = [safeName(document.articleId), document.lotCode ? 'Lotto ' + safeName(document.lotCode) : 'Generali', safeName(document.originalFileName || document.title)].join('/');
      let name = base, suffix = 2;
      while (usedNames.has(name.toUpperCase())) {
        const extension = /\.[^./]+$/.exec(base)?.[0] || '';
        name = (extension ? base.slice(0, -extension.length) : base) + ' (' + suffix++ + ')' + extension;
      }
      usedNames.add(name.toUpperCase()); zip.file(name, data);
      onProgress(++completed, unique.length);
    }
  }
  return zip.generate({ type: 'uint8array', compression: 'STORE' });
}
