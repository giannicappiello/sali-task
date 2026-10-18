// Fixed same-origin bridge. No service credentials are present in the Club app.
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST');return res.status(405).json({ error: 'Metodo non consentito.' }); }
  if (!/^Bearer .+$/.test(String(req.headers.authorization || ''))) return res.status(401).json({ error: 'Accedi come negozio per generare un ordine.' });
  try {
    const response = await fetch('https://workspace.progre.it/api/mexal/automation?route=club-supply-order', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: req.headers.authorization },
      body: JSON.stringify({ payload: req.body }), signal: AbortSignal.timeout(25000),
    });
    const body = await response.json();return res.status(response.status).json(body);
  } catch { return res.status(502).json({ error: 'Collegamento a PROGRE\' temporaneamente non disponibile. Riprova con lo stesso ordine.' }); }
}
