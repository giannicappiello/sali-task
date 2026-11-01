import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';

const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c]);
export function page(title, content, nonce) {
  return `<!doctype html><html lang="it"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escape(title)}</title><style nonce="${nonce}">body{font:17px system-ui;background:#f1f5f7;color:#142f3d;max-width:760px;margin:5vh auto;padding:24px}main{background:white;padding:28px;border-radius:16px}label{display:block;margin:18px 0}input{display:block;width:95%;padding:12px;font:inherit}button{padding:12px 20px;margin:12px 8px 0 0;font:inherit;cursor:pointer}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:14px}small{color:#52636b}</style><main><h1>${escape(title)}</h1>${content}</main></html>`;
}
export async function startInteraction({ type, client, proposal, onChanged = () => {}, ttlMs = 300000 }) {
  const secret = randomBytes(32).toString('hex'), nonce = randomBytes(16).toString('hex');
  let status = 'waiting', outcome = null, busy = false;
  // Receipts and credentials never enter MCP outputs or model context.
  const prepared = type === 'confirmation' ? await client.request({ action: 'confirmation', ...proposal }) : null;
  if (prepared?.terminal) return { terminal: true, outcome: prepared.proposal };
  const server = createServer(async (req, res) => {
    const origin = `http://127.0.0.1:${server.address().port}`;
    // no-referrer turns native form POST Origin into "null" in browsers,
    // conflicting with the required same-origin check below.
    res.setHeader('Cache-Control','no-store'); res.setHeader('Referrer-Policy','same-origin');
    res.setHeader('X-Content-Type-Options','nosniff'); res.setHeader('X-Frame-Options','DENY');
    res.setHeader('Content-Security-Policy', `default-src 'none'; style-src 'nonce-${nonce}'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'`);
    const url = new URL(req.url, origin);
    if (req.headers.host !== `127.0.0.1:${server.address().port}` || url.pathname !== `/${secret}`) { res.writeHead(404); res.end(); return; }
    if (req.method === 'GET') {
      res.setHeader('Content-Type','text/html; charset=utf-8');
      if (status !== 'waiting') { res.end(page('Second Brain Progre', `<p>${status === 'completed' ? 'Operazione conclusa. Torna a Codex e verifica il risultato.' : 'Sessione terminata. Riaprire dalla chat.'}</p>`, nonce)); return; }
      const content = type === 'login'
        ? '<p>Collega il tuo utente Workspace. La password viene trasmessa solo al servizio di autenticazione Workspace e non viene salvata.</p><form method="post"><label>Email Workspace<input type="email" name="email" required autocomplete="username"></label><label>Password<input type="password" name="password" required autocomplete="current-password"></label><button>Collega Workspace</button></form>'
        : `<p>Utente: <strong>${escape(prepared.identity.name)}</strong></p><p>Verifica il riepilogo completo. Confermando autorizzi questa operazione sui dati aziendali.</p><pre>${escape(JSON.stringify({ tool: prepared.proposal.tool, input: prepared.proposal.input || prepared.proposal.payload_summary, before: prepared.proposal.before_snapshot }, null, 2))}</pre><form method="post"><button name="decision" value="confirm">Confermo questa operazione</button><button name="decision" value="reject">Rifiuta</button></form>`;
      res.end(page(type === 'login' ? 'Accedi a Second Brain Progre' : 'Conferma operazione', content, nonce)); return;
    }
    if (req.method !== 'POST' || req.headers.origin !== origin || status !== 'waiting' || busy || !String(req.headers['content-type']).startsWith('application/x-www-form-urlencoded')) { res.writeHead(403); res.end(); return; }
    busy = true;
    try {
      let body = ''; for await (const chunk of req) { body += chunk; if (body.length > 12000) throw new Error('Modulo troppo grande.'); }
      const input = new URLSearchParams(body);
      if (type === 'login') {
        const email = input.get('email'), password = input.get('password');
        if (!email || !password) throw new Error('Email e password obbligatorie.');
        outcome = await client.login(email, password);
      } else {
        if (!['confirm','reject'].includes(input.get('decision'))) throw new Error('Decisione non valida.');
        // A failed/uncertain execution consumes this UI; never resubmit on refresh.
        status = 'submitted';
        outcome = await client.request({ action: 'decide', receipt: prepared.receipt, decision: input.get('decision') });
      }
      status = 'completed'; onChanged();
      res.setHeader('Content-Type','text/html; charset=utf-8'); res.end(page('Second Brain Progre', '<p>Operazione conclusa. Torna a Codex per verificare il risultato.</p>', nonce));
    } catch (error) {
      if (type === 'confirmation') { status = 'uncertain'; outcome = { error: 'Esito da verificare. Leggere lo stato persistito; non ripetere la scrittura.' }; }
      res.writeHead(400, { 'Content-Type':'text/html; charset=utf-8' });
      res.end(page('Operazione non conclusa', `<p>${escape(type === 'login' ? error.message : outcome.error)}</p>`, nonce));
    } finally { busy = false; }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const timer = setTimeout(() => { if (status === 'waiting') status = 'expired'; server.close(); }, ttlMs); timer.unref();
  return { url: `http://127.0.0.1:${server.address().port}/${secret}`, getStatus: () => ({ type, status, outcome }), close: () => { clearTimeout(timer); server.close(); } };
}
