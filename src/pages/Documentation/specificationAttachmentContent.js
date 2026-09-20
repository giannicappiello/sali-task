import { specificationFileRequest } from '../../../shared/productSpecification.js';

export async function specificationAttachmentContent(articleCode, attachment, request) {
  const [path, options] = specificationFileRequest(articleCode, attachment);
  const chunks = [];
  let offset = 0;
  do {
    const part = await request(`${path}&content=true&offset=${offset}`, options);
    if (typeof part.base64 !== 'string') throw new Error('Contenuto immagine NAS non disponibile.');
    const bytes = Uint8Array.from(atob(part.base64), c => c.charCodeAt(0));
    if (!bytes.length || bytes.length > 1024 * 1024 || offset + bytes.length > 20 * 1024 * 1024)
      throw new Error('Immagine NAS vuota o superiore a 20 MB.');
    chunks.push(bytes);
    if (part.nextOffset === null) return new Blob(chunks);
    if (part.nextOffset !== offset + bytes.length) throw new Error('Immagine NAS incompleta.');
    offset = part.nextOffset;
  } while (offset < 20 * 1024 * 1024);
  throw new Error('Immagine NAS superiore a 20 MB.');
}
