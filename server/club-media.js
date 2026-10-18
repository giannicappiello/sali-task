import { signedUrl, filePath } from './document-gateway.js';

export async function handleClubMedia(req, res, admin) {
  const input = req.body?.ids;
  const valid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
  if (!Array.isArray(input) || input.length > 40 || input.some(id => typeof id !== 'string' || !valid.test(id))) return res.status(400).json({ error: 'Elenco materiali non valido.' });
  let viewer = null;
  if (req.headers.authorization) {
    const header = String(req.headers.authorization);
    if (!header.startsWith('Bearer ')) return res.status(401).json({ error: 'Sessione non valida.' });
    const { data, error } = await admin.auth.getUser(header.slice(7));
    if (error || !data?.user) return res.status(401).json({ error: 'Sessione non valida.' });
    viewer = data.user.id;
  }
  const { data, error } = await admin.rpc('club_media_paths', { document_ids: [...new Set(input)], viewer_auth_id: viewer });
  if (error) throw error;
  res.setHeader('Cache-Control', 'private, no-store');
  return res.status(200).json({ urls: Object.fromEntries(Object.entries(data || {}).map(([id, path]) => [id, signedUrl(filePath(path))])), expiresIn: 900 });
}
