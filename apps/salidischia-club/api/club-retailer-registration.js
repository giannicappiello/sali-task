export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST');return res.status(405).json({ error: 'Metodo non consentito.' }); }
  const { mode, vat_number, token, password, shop_name } = req.body || {};
  if (!['lookup', 'signup'].includes(mode) || (mode === 'lookup' && (typeof vat_number !== 'string' || vat_number.length > 32)) || (mode === 'signup' && (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token) || typeof password !== 'string' || password.length < 6 || password.length > 128 || typeof shop_name !== 'string' || shop_name.length > 120))) return res.status(400).json({ error: 'Controlla i dati. La password deve avere almeno 6 caratteri.' });
  try {
    const response = await fetch('https://workspace.progre.it/api/mexal/automation?route=club-retailer-registration', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode, vat_number, token, password, shop_name }), signal: AbortSignal.timeout(25000) });
    const data = await response.json();return res.status(response.status).json(data);
  } catch { return res.status(502).json({ error: 'Workspace non è momentaneamente raggiungibile. Riprova.' }); }
}
