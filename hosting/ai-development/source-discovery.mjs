import { Buffer } from 'node:buffer';
import { posix } from 'node:path';
import { safeDevelopmentPath } from './worker-paths.mjs';

// Discovery must not spend the four compilation/repair attempts.
export const MAX_SOURCE_ROUNDS = 20;
export const MAX_CHECK_ATTEMPTS = 4;
export const SOURCE_EXTENSIONS = /\.(?:[cm]?jsx?|tsx?|json|cs|csproj|razor|css|sql|md|yml|yaml)$/;

export function supplySources(source, index, supplied, requested, { requireProgress = true } = {}) {
  const allowed = new Set(index);
  if (!Array.isArray(requested) || requested.length > 100) throw new Error('Richiesta sorgenti non valida.');
  const added = [];
  const queue = requested.map(path => ({ path, required: true, depth: 0 }));
  const visited = new Set();
  for (const { path, required, depth } of queue) {
    if (!safeDevelopmentPath(path) || !allowed.has(path) || !Object.hasOwn(source.files, path)) {
      if (required) throw new Error('File richiesto fuori dalla revisione: ' + path);
      continue;
    }
    if (visited.has(path)) continue;
    visited.add(path);
    const content = Buffer.from(source.files[path], 'base64').toString('utf8');
    if (content.includes('\u0000') || content.length > 200000) {
      if (required) throw new Error('File non testuale o troppo grande: ' + path);
      continue;
    }
    if (!Object.hasOwn(supplied, path)) {
      // Leave room for the index, instructions and test diagnostics in the API payload.
      if (JSON.stringify({ ...supplied, [path]: content }).length > 1800000) {
        if (required) throw new Error('Contesto sorgenti completo: impossibile aggiungere ' + path);
        continue;
      }
      supplied[path] = content;
      added.push(path);
    }
    if (depth >= 1) continue;
    // Read direct local imports together with their component; never execute repository code.
    for (const match of content.matchAll(/(?:\bfrom\s*|\bimport\s*(?:\(\s*)?|\brequire\s*\(\s*)['"](\.[^'"]+)['"]/g)) {
      const base = posix.normalize(posix.join(posix.dirname(path), match[1]));
      const dependency = [base, ...['.js', '.jsx', '.mjs', '.ts', '.tsx', '.css', '/index.js', '/index.jsx', '/index.ts', '/index.tsx'].map(ext => base + ext)].find(candidate => allowed.has(candidate));
      if (dependency) queue.push({ path: dependency, required: false, depth: depth + 1 });
    }
  }
  if (requireProgress && !added.length) throw new Error('La ricerca ha richiesto solo file già disponibili. Nessun nuovo sorgente da leggere.');
  return added;
}
