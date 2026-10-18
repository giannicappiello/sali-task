import process from 'node:process';
import { createHmac } from 'node:crypto';

const required = name => {
  const value = String(process.env[name] || '').trim().replace(/\/$/, '');
  if (!value) throw Object.assign(new Error(`Variabile Vercel mancante: ${name}`), { status: 500 });
  return value;
};
export function signedUrl(pathname) {
  const expires = Math.floor(Date.now() / 1000) + 900;
  const signature = createHmac('sha256', required('DOCUMENT_GATEWAY_SECRET')).update(`${pathname}\n${expires}`).digest('hex');
  return `${required('DOCUMENT_GATEWAY_URL')}${pathname}?expires=${expires}&signature=${signature}`;
}
export function filePath(path) { return `/files/${String(path).split('/').map(encodeURIComponent).join('/')}`; }
