import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { copyFile, lstat, mkdir, open, readFile, realpath, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const SHEET_FILE_PATTERN = /^(?:IT|MKT)[A-Z0-9_-]+(?:_(?:IT|ENG|FR|DE|ES|PT)\.jpeg|\.pdf)$/;
const MAX_SIZE = 20 * 1024 * 1024;
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
export function sheetArchiveCanonical(method, pathname, input) {
  return ['direct-sheet-v1', method, pathname, input.expires, input.sha256, input.size, input.revision, input.issuedAt].join('\n');
}
export function signSheetArchive({ baseUrl, secret, filename, sha256, size, revision, issuedAt, method = 'PUT', now = Date.now() }) {
  const pathname = `/generated-sheets/${encodeURIComponent(filename)}`, input = { expires: Math.floor(now / 1000) + 600, sha256, size, revision, issuedAt };
  const url = new URL(`${baseUrl.replace(/\/$/, '')}${pathname}`);
  for (const [key, value] of Object.entries(input)) url.searchParams.set(key, value);
  url.searchParams.set('signature', createHmac('sha256', secret).update(sheetArchiveCanonical(method, pathname, input)).digest('hex'));
  return url.href;
}
function authenticated(method, url, secret, now) {
  const p = Object.fromEntries(url.searchParams), expires = Number(p.expires);
  if (!Number.isInteger(expires) || expires < Math.floor(now / 1000) || expires > Math.floor(now / 1000) + 900 || !/^[a-f0-9]{64}$/.test(p.sha256 || '') || !/^[a-f0-9]{64}$/.test(p.signature || '') || !Number.isInteger(Number(p.size)) || Number(p.size) < 1 || Number(p.size) > MAX_SIZE || !Number.isInteger(Number(p.revision)) || Number(p.revision) < 1 || !Number.isSafeInteger(Number(p.issuedAt)) || Number(p.issuedAt) > now + 30000 || Number(p.issuedAt) < now - 900000) return false;
  const expected = createHmac('sha256', secret).update(sheetArchiveCanonical(method, url.pathname, p)).digest('hex');
  return timingSafeEqual(Buffer.from(expected), Buffer.from(p.signature));
}
async function safeFolder(root, folder) {
  if (!folder || path.isAbsolute(folder) || folder.includes(':') || folder.replaceAll('\\', '/').split('/').some(p => !p || p === '.' || p === '..')) throw fail('Cartella schede tecniche non valida.', 503);
  const rootReal = await realpath(root); let current = rootReal;
  for (const segment of folder.replaceAll('\\', '/').split('/')) {
    current = path.join(current, segment);
    await mkdir(current).catch(e => { if (e.code !== 'EEXIST') throw e; });
    const stat = await lstat(current), resolved = await realpath(current);
    if (!stat.isDirectory() || stat.isSymbolicLink() || !resolved.startsWith(rootReal + path.sep)) throw fail('Cartella NAS fuori dall’archivio.', 403);
  }
  return current;
}
async function regularFile(file) {
  try { const stat = await lstat(file); if (!stat.isFile() || stat.isSymbolicLink()) throw fail('Destinazione non valida.', 403); return stat; } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
}
async function optionalJson(file) { if (!await regularFile(file)) return null; return JSON.parse(await readFile(file, 'utf8')); }
export function createGeneratedSheetHandler({ root, secret, folder = 'Schede Tecniche', enabled = false, origins = ['https://workspace.progre.it'], now = Date.now }) {
  return async function handle(req, res, url) {
    if (!url.pathname.startsWith('/generated-sheets/')) return false;
    let lock, lockPath, temporary;
    const unlock = async () => { if (lock) { const handle = lock; lock = null; await handle.close(); await unlink(lockPath).catch(() => {}); } };
    const reply = async (status, body) => { await unlock(); res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(body)); return true; };
    const origin = req.headers.origin;
    if (origin && !origins.includes(origin)) return reply(403, { error: 'Origine non autorizzata.' });
    if (origin) { res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin'); }
    if (req.method === 'OPTIONS') { res.setHeader('Access-Control-Allow-Methods', 'PUT, GET, OPTIONS'); res.setHeader('Access-Control-Allow-Headers', 'Content-Type'); return reply(200, { ok: true }); }
    if (!enabled) return reply(503, { error: 'Salvataggio schede tecniche non abilitato sul gateway NAS.' });
    if (!['PUT', 'GET'].includes(req.method) || !authenticated(req.method, url, secret, now())) return reply(403, { error: 'Autorizzazione file non valida o scaduta.' });
    let filename;
    try { filename = decodeURIComponent(url.pathname.slice('/generated-sheets/'.length)); } catch { return reply(400, { error: 'Nome file non valido.' }); }
    if (!SHEET_FILE_PATTERN.test(filename)) return reply(400, { error: 'Nome file non valido.' });
    const p = Object.fromEntries(url.searchParams);
    try {
      const directory = await safeFolder(root, folder), target = path.join(directory, filename), metaPath = path.join(directory, `.${filename}.json`);
      if (req.method === 'GET') {
        if (!await regularFile(target)) return reply(404, { error: 'File non presente sul NAS.' });
        const bytes = await readFile(target), metadata = await optionalJson(metaPath);
        return reply(200, { filename, sha256: createHash('sha256').update(bytes).digest('hex'), size: bytes.length, revision: metadata?.revision, issuedAt: metadata?.issuedAt });
      }
      lockPath = path.join(directory, `.${filename}.lock`);
      try { lock = await open(lockPath, 'wx'); } catch (e) { if (e.code === 'EEXIST') return reply(409, { error: 'Salvataggio dello stesso file già in corso. Riprova.' }); throw e; }
      const metadata = await optionalJson(metaPath);
      if (metadata && (metadata.revision > Number(p.revision) || metadata.issuedAt > Number(p.issuedAt))) return reply(409, { error: 'Sul NAS è già presente una generazione più recente.' });
      const chunks = []; let size = 0;
      for await (const chunk of req) { size += chunk.length; if (size > Number(p.size) || size > MAX_SIZE) throw fail('Dimensione file non valida.', 413); chunks.push(chunk); }
      const bytes = Buffer.concat(chunks), hash = createHash('sha256').update(bytes).digest('hex');
      if (size !== Number(p.size) || hash !== p.sha256) throw fail('Verifica checksum file non riuscita.');
      const pdf = filename.endsWith('.pdf'), mime = pdf ? 'application/pdf' : 'image/jpeg';
      if (String(req.headers['content-type'] || '').split(';')[0] !== mime || (pdf ? bytes.subarray(0, 5).toString() !== '%PDF-' || !bytes.subarray(-1024).toString().includes('%%EOF') : bytes[0] !== 255 || bytes[1] !== 216 || bytes[2] !== 255 || bytes.at(-2) !== 255 || bytes.at(-1) !== 217)) throw fail('Contenuto non corrispondente al formato file.');
      temporary = path.join(directory, `.${filename}.${randomUUID()}.tmp`);
      await writeFile(temporary, bytes, { flag: 'wx' });
      if (await regularFile(target)) {
        const versions = await safeFolder(root, `${folder.replaceAll('\\', '/')}/.versions`);
        await copyFile(target, path.join(versions, `${now()}-${randomUUID()}-${filename}`));
      }
      await rename(temporary, target); temporary = null;
      const nextMeta = path.join(directory, `.${filename}.${randomUUID()}.json.tmp`);
      await writeFile(nextMeta, JSON.stringify({ revision: Number(p.revision), issuedAt: Number(p.issuedAt), sha256: hash, size }), { flag: 'wx' });
      await rename(nextMeta, metaPath);
      return reply(200, { filename, sha256: hash, size, saved: true });
    } catch (e) { return reply(e.status || 500, { error: e.status ? e.message : 'Salvataggio sul NAS non riuscito.' }); }
    finally { if (temporary) await unlink(temporary).catch(() => {}); await unlock(); }
  };
}
