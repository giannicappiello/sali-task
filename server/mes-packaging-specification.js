import { createClient } from '@supabase/supabase-js';
import { verifyProductionMessage } from './progremes-production-hmac.js';

export const PACKAGING_SPECIFICATION_PATH = '/api/mexal/automation';
export function specificationPiecesPerBox(value) {
  const text = String(value ?? '').trim();
  if (!/^\d+$/.test(text)) return null;
  const number = Number(text);
  return Number.isSafeInteger(number) && number > 0 && number <= 1000000000 ? number : null;
}
export async function resolveMesPackagingSpecification(req, body, { env = globalThis.process.env, adminFactory } = {}) {
  const raw = typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {});
  if (!verifyProductionMessage({ method: 'POST', path: PACKAGING_SPECIFICATION_PATH, headers: req.headers || {}, body: raw, secret: env.PROGREMES_INTEGRATION_SECRET }))
    throw Object.assign(new Error('Autenticazione MES non valida.'), { status: 401 });
  const articleCode = String(body.articleCode || '').trim().toUpperCase();
  if (!articleCode || articleCode.length > 200) throw Object.assign(new Error('Codice prodotto non valido.'), { status: 400 });
  const admin = adminFactory ? adminFactory() : createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await admin.from('workspace_product_specifications').select('article_code,version,data').eq('article_code', articleCode).maybeSingle();
  if (error) throw error;
  return { articleCode, piecesPerBox: specificationPiecesPerBox(data?.data?.piecesPerBox), specificationVersion: data?.version ?? null };
}
