import { createHash } from 'node:crypto';
import { articleType, rows, readArchive, catalogue, normalizePath, gatewayUrl, key } from './private-documents-store.js';
import { specificationFields, specificationAttachmentSections, isSpecificationImage, MAX_SPECIFICATION_ATTACHMENTS } from '../shared/productSpecification.js';
import { loadSpecificationSources } from './product-specification-sources.js';

const fail = (message, status = 400) => Object.assign(new Error(message), { status });
export function validateSpecification(input) {
  if (!input || !Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 0)
    throw fail('Versione capitolato non valida. Ricaricare la scheda.');
  if (!input.data || typeof input.data !== 'object' || Array.isArray(input.data)) throw fail('Dati capitolato non validi.');
  const data = {};
  for (const [name, , type] of specificationFields) {
    const v = input.data[name] ?? '';
    if (typeof v !== 'string' || v.length > (type === 'textarea' ? 5000 : 500)) throw fail(`Campo ${name} non valido o troppo lungo.`);
    if (type === 'yesno' && !['', 'yes', 'no'].includes(v)) throw fail(`Campo ${name} non valido.`);
    data[name] = v.trim();
  }
  if (!Array.isArray(input.attachments) || input.attachments.length > MAX_SPECIFICATION_ATTACHMENTS)
    throw fail(`Sono consentiti al massimo ${MAX_SPECIFICATION_ATTACHMENTS} allegati.`);
  const seen = new Set();
  const attachments = input.attachments.map(item => {
    if (!item || !specificationAttachmentSections.includes(item.section)) throw fail('Sezione allegato non valida.');
    const path = normalizePath(item.path);
    if (path.length > 2000 || !/\.(?:pdf|jpe?g|png|webp|gif|mp4|webm|mov|m4v)$/i.test(path)) throw fail('Formato allegato non supportato.');
    if (item.section === 'product' && !isSpecificationImage(path)) throw fail('Per le foto prodotto selezionare un’immagine.');
    const caption = item.caption ?? '';
    if (typeof caption !== 'string' || caption.length > 500) throw fail('Didascalia non valida.');
    const id = createHash('sha256').update(JSON.stringify([item.section, key(path)])).digest('hex');
    if (seen.has(id)) throw fail('File già associato a questa sezione.');
    seen.add(id);
    return { id, section: item.section, path, caption: caption.trim(), name: path.split('/').at(-1) };
  });
  return { data, attachments };
}

export function specificationRequiresWrite(pathname) {
  return ['/specifications/save', '/specifications/preview'].includes(pathname);
}

export async function authorizeSpecificationArticle(identity, code) {
  if (!code || code.length > 200) throw fail('Codice articolo non valido.');
  const { admin, customerCodes } = identity;
  if (!customerCodes.includes('*')) {
    const archive = await readArchive(admin, code);
    const article = catalogue(archive, customerCodes).find(a => key(a.articleCode) === key(code));
    if (!article || article.articleType !== 'ProdottoFinito') throw fail('Prodotto finito non disponibile.', 404);
    return article.articleCode;
  }
  const { data, error } = await admin.from('ordini_prodotti_cache')
    .select('codice_articolo,has_bom:dati_mexal->>gest_dbp').eq('codice_articolo', code).maybeSingle();
  if (error) throw error;
  if (!data || articleType(data.codice_articolo, data.has_bom) !== 'ProdottoFinito') throw fail('Prodotto finito non disponibile.', 404);
  return data.codice_articolo;
}

const dto = row => row ? { data: row.data, attachments: row.attachments, version: row.version, updatedAt: row.updated_at, updatedBy: row.updated_by_label } : null;

export async function productSpecificationOperation(identity, path, input = {}) {
  const url = new URL(path, 'https://workspace.invalid/');
  if (!['/specifications', '/specifications/sources', '/specifications/save', '/specifications/preview', '/specifications/file', '/specifications/history'].includes(url.pathname))
    throw fail('Operazione capitolato non disponibile.', 404);
  if (specificationRequiresWrite(url.pathname) && (!identity.canWriteDocuments || !identity.customerCodes.includes('*')))
    throw fail('Modifica capitolato non autorizzata.', 403);
  const code = await authorizeSpecificationArticle(identity, String(url.searchParams.get('articleCode') || '').trim());
  const { admin, profile } = identity;
  if (url.pathname === '/specifications/sources') return loadSpecificationSources(identity, code);
  if (url.pathname === '/specifications/history') {
    const { data, error } = await admin.from('workspace_product_specification_revisions')
      .select('version,updated_at,updated_by_label').eq('article_code', code).order('version', { ascending: false }).limit(50);
    if (error) throw error;
    return { revisions: data.map(r => ({ version: r.version, updatedAt: r.updated_at, updatedBy: r.updated_by_label })) };
  }
  if (url.pathname === '/specifications/save') {
    const validated = validateSpecification(input);
    if (validated.attachments.length) {
      const files = await rows(admin, 'workspace_private_nas_files', 'path_key,path,active', q => q.in('path_key', validated.attachments.map(a => key(a.path))));
      for (const attachment of validated.attachments) {
        const file = files.find(f => f.active && f.path_key === key(attachment.path));
        if (!file) throw fail(`File NAS non disponibile: ${attachment.name}. Rimuovere il collegamento o aggiornare l’archivio.`);
        attachment.path = file.path;
        attachment.name = file.path.split('/').at(-1);
      }
    }
    const { data, error } = await admin.rpc('save_workspace_product_specification', {
      p_article_code: code, p_expected_version: input.expectedVersion, p_data: validated.data,
      p_attachments: validated.attachments, p_user_id: profile.id, p_user_label: profile.email || 'Utente Workspace',
    });
    if (['PT409', '40001'].includes(error?.code)) throw fail('Il capitolato è stato modificato da un’altra persona. Ricaricare la versione aggiornata prima di salvare.', 409);
    if (error) throw error;
    return dto(data);
  }
  const { data: spec, error } = await admin.from('workspace_product_specifications').select('*').eq('article_code', code).maybeSingle();
  if (error) throw error;
  if (url.pathname === '/specifications') return { specification: dto(spec) };
  const attachment = url.pathname === '/specifications/preview'
    ? validateSpecification({ expectedVersion: 0, data: {}, attachments: [input] }).attachments[0]
    : spec?.attachments.find(a => a.id === url.searchParams.get('attachmentId'));
  if (!attachment) throw fail('Allegato capitolato non disponibile.', 404);
  const { data: file, error: fileError } = await admin.from('workspace_private_nas_files').select('path,active').eq('path_key', key(attachment.path)).maybeSingle();
  if (fileError) throw fileError;
  if (!file?.active) throw fail('File non più disponibile sul NAS. Aggiornare l’archivio.', 404);
  const { error: auditError } = await admin.from('workspace_product_specification_access_log').insert({ article_code: code, user_id: profile.id, attachment_id: attachment.id });
  if (auditError) throw auditError;
  return { url: gatewayUrl('/files/' + normalizePath(file.path).split('/').map(encodeURIComponent).join('/')) };
}
