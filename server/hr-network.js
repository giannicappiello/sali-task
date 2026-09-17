/* global process */
import { isIP } from 'node:net';
import { createClient } from '@supabase/supabase-js';

// Trust only Vercel's ingress header, never an IP supplied by the browser/body.
// https://vercel.com/docs/headers/request-headers#x-vercel-forwarded-for
export function trustedHrIp(req, hosted = process.env.VERCEL === '1') {
  const value = req.headers?.['x-vercel-forwarded-for'];
  if (!hosted || typeof value !== 'string' || !isIP(value.trim())) {
    throw Object.assign(new Error('Impossibile verificare la rete di provenienza. Riprova da Workspace.'), { status: 403 });
  }
  return value.trim();
}

const defaultClient = () => createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
export async function hrNetworkRequest(req, admin = defaultClient(), hosted = process.env.VERCEL === '1') {
  if (!['GET','POST'].includes(req.method)) throw Object.assign(new Error('Metodo non consentito.'), { status: 405 });
  const token = /^Bearer (.+)$/i.exec(String(req.headers?.authorization || ''))?.[1];
  if (!token) throw Object.assign(new Error('Accedi a Workspace per continuare.'), { status: 401 });
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data?.user?.id) throw Object.assign(new Error('Sessione non valida. Accedi nuovamente.'), { status: 401 });
  const ip = trustedHrIp(req, hosted);
  if (req.method === 'GET') {
    const { data: profile, error: failure } = await admin.from('utenti').select('attivo,ruoli(amministratore_workspace)').eq('auth_user_id',data.user.id).maybeSingle();
    if (failure || !profile || profile.attivo === false || profile.ruoli?.amministratore_workspace !== true) throw Object.assign(new Error('Configurazioni riservate agli admin.'), { status: 403 });
    return { ip };
  }
  let body=req.body;
  if (typeof body === 'string') { try { body=JSON.parse(body); } catch { body=null; } }
  const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!body || !['in','out'].includes(body.action) || !uuid.test(body.key || '') || (body.action==='out' && !uuid.test(body.attendance_id || ''))) throw Object.assign(new Error('Timbratura non valida.'),{status:400});
  const result=await admin.rpc('workspace_hr_network_punch',{p_auth_user:data.user.id,p_action:body.action,p_key:body.key,p_ip:ip,p_attendance_id:body.action==='out'?body.attendance_id:null});
  if(result.error) throw Object.assign(new Error(result.error.message || 'Timbratura non disponibile.'),{status:403});
  return result.data;
}

export async function handleHrNetwork(req,res) {
  res.setHeader('Cache-Control','private, no-store');
  try { return res.status(200).json(await hrNetworkRequest(req)); }
  catch(error) { return res.status(error.status || 500).json({error:error.status ? error.message : 'Servizio timbrature non disponibile. Riprova.'}); }
}
