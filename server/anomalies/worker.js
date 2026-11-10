import { timingSafeEqual } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { createProgremesReadonlyAdmin } from '../progremes-readonly-auth.js';
import { businessWindow, evaluatePlanning } from './engine.js';
const must = r => { if (r.error) throw r.error; return r.data; };

export async function runDaily(db, { now = new Date(), loadSnapshot } = {}) {
 const window = businessWindow(now);
 if (!window.due) return { status: 'outside_schedule', timezone: 'Europe/Rome' };
 const agent = must(await db.from('anomaly_agents').select('*').eq('code', 'fabbisogni').single());
 if (!agent.enabled) return { status: 'disabled', readiness: agent.readiness };
 if (agent.readiness?.ready !== true || typeof loadSnapshot !== 'function') return { status: 'blocked', reason: 'Verified read-only source adapters unavailable. No findings, email or management changes produced.' };
 const existing = must(await db.from('anomaly_runs').select('id,status').eq('agent_code', agent.code).eq('business_day', window.from).maybeSingle());
 if (existing) return { status: 'already_recorded', run: existing };
 // Snapshot collection is read-only. Only the final atomic RPC persists findings.
 const snapshot = await loadSnapshot({ from: window.from, toExclusive: window.toExclusive, yesterday: window.yesterday });
 const result = evaluatePlanning(snapshot, now);
 const persisted = must(await db.rpc('anomaly_record_run', { p_day: window.from, p_status: result.status, p_coverage: { gaps: result.gaps, window: result.window, sources: snapshot.coverage }, p_findings: result.findings }));
 return { status: result.status, run: persisted, delivery: 'not_sent', reason: 'PDF template rendering, recipient scope and authorized transport must be verified before delivery' };
}
export async function handleAnomalyCron(req, res, { env = globalThis.process.env, admin = createProgremesReadonlyAdmin, ...dependencies } = {}) {
 res.setHeader('Cache-Control', 'no-store');
 const expected = String(env.CRON_SECRET || ''), actual = String(req.headers?.authorization || '').replace(/^Bearer /, '');
 if (req.method !== 'GET') return res.status(405).json({ error: 'Metodo non consentito.' });
 if (!expected || expected.length !== actual.length || !timingSafeEqual(Buffer.from(expected), Buffer.from(actual))) return res.status(401).json({ error: 'Cron non autorizzato.' });
 try { return res.json(await runDaily(admin(), dependencies)); }
 catch { return res.status(503).json({ status: 'failed', error: 'Controllo non concluso. Verificare il run persistito prima di ripetere.' }); }
}
