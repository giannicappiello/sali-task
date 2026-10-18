// Same-origin bridge to the existing Workspace document service. Secrets and
// NAS signing remain exclusively in Workspace; the destination is fixed.
export default async function handler(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'Metodo non consentito.' }); }
  const ids = req.body?.document_ids;
  if (!Array.isArray(ids) || ids.length > 40 || ids.some(id => typeof id !== 'string' || !/^[a-f0-9-]{36}$/i.test(id))) return res.status(400).json({ error: 'Elenco materiali non valido.' });
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (req.headers.authorization) headers.Authorization = String(req.headers.authorization);
    const response = await fetch('https://workspace.progre.it/api/mexal/automation', { method: 'POST', headers, body: JSON.stringify({ action: 'document_club_urls', ids }), signal: AbortSignal.timeout(20000) });
    const data = await response.json().catch(() => ({ error: 'Archivio Workspace temporaneamente non disponibile.' }));
    res.setHeader('Cache-Control', 'private, no-store');
    return res.status(response.status).json(data);
  } catch { return res.status(502).json({ error: 'Archivio Workspace temporaneamente non disponibile. Riprova.' }); }
}
