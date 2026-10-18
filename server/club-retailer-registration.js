import { createHash, randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import process from 'node:process';

export function maskRetailerEmail(email) {
  const at = email.lastIndexOf('@');
  if (at < 1) throw new Error('Invalid registered email');
  const local = Array.from(email.slice(0, at));
  return local[0] + '.'.repeat(local.length - 1) + email.slice(at);
}
const hash = value => createHash('sha256').update(value).digest('hex');
export async function handleRetailerRegistration(req, res, admin) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Metodo non consentito.' });
  const { mode, vat_number: vat, token, password, shop_name: shopName = '' } = req.body || {};
  if (!['lookup', 'signup'].includes(mode)) return res.status(400).json({ error: 'Richiesta non valida.' });
  const call = async (name, args) => { const { data, error } = await admin.rpc(name, args);if (error) throw Object.assign(new Error(error.code === 'P0001' ? error.message : error.code === '23505' ? 'Account già presente. Usa Accedi o recupera la password.' : 'Verifica temporaneamente non disponibile.'), { status: ['P0001','23505'].includes(error.code) ? 400 : 500 });return data; };
  try {
    const peer = String(req.headers['x-vercel-forwarded-for'] || req.headers['x-real-ip'] || req.socket?.remoteAddress || 'edge').slice(0, 200);
    if (!await call('club_registration_limit', { bucket_key: 'ip:' + hash(peer), max_requests: 100, window_seconds: 300 })) return res.status(429).json({ error: 'Troppe richieste. Attendi qualche minuto.' });
    if (mode === 'lookup') {
      if (typeof vat !== 'string' || vat.length > 32) return res.status(400).json({ error: 'Partita IVA non valida.' });
      if (!await call('club_registration_limit', { bucket_key: 'vat:' + hash(vat.replace(/\W/g, '').toUpperCase()), max_requests: 25, window_seconds: 900 })) return res.status(429).json({ error: 'Attendi qualche minuto prima di riprovare.' });
      const challenge = randomBytes(32).toString('hex');
      const customer = await call('club_retailer_lookup', { vat_number: vat, challenge_hash: hash(challenge) });
      const details = Object.fromEntries(['legal_name', 'vat_number', 'tax_code', 'address', 'postal_code', 'city', 'province', 'country', 'phone', 'shop_name'].map(key => [key, customer[key] ?? null]));
      return res.status(200).json({ ...details, token: challenge, masked_email: maskRetailerEmail(customer.email) });
    }
    if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token) || typeof password !== 'string' || password.length < 6 || password.length > 128 || typeof shopName !== 'string' || shopName.length > 120) return res.status(400).json({ error: 'Controlla i dati. La password deve avere almeno 6 caratteri.' });
    const challenge = await call('club_retailer_challenge', { challenge_hash: hash(token) });
    if (!challenge) return res.status(400).json({ error: 'Verifica scaduta. Riparti dalla partita IVA.' });
    if (!await call('club_registration_limit', { bucket_key: 'signup:' + hash(challenge.email.toLowerCase()), max_requests: 5, window_seconds: 3600 })) return res.status(429).json({ error: 'Controlla la tua email prima di riprovare. Puoi anche usare Accedi o recuperare la password.' });
    // Normal signup sends verification to the CRM email; never auto-confirm a retailer.
    const { data, error } = await admin.auth.signUp({ email: challenge.email, password, options: { emailRedirectTo: 'https://club.salidischia.it/', data: { club_app: 'salidischia-club', club_registration_kind: 'store', nome: challenge.legal_name } } });
    if (error || !data?.user?.id) return res.status(400).json({ error: 'Non è stato possibile creare l’account. Usa Accedi se sei già registrato, oppure riprova tra poco.' });
    if (data.session || data.user.email_confirmed_at) return res.status(503).json({ error: 'Per registrare un negozio deve essere attiva la conferma dell’email. Contatta il backoffice.' });
    await call('club_bind_retailer_registration', { registration_id: challenge.registration_id, identity_id: data.user.id, shop_name: shopName.trim() });
    return res.status(200).json({ message: 'Controlla l’email già registrata in Workspace e conferma l’indirizzo. Poi accedi per completare l’iscrizione del negozio.' });
  } catch (error) { return res.status(error.status || 500).json({ error: error.status === 400 ? error.message : 'Registrazione temporaneamente non disponibile. Riprova.' }); }
}
export default async function handler(req, res) {
  const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  return handleRetailerRegistration(req, res, admin);
}
