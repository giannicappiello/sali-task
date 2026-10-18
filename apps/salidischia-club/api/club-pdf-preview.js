import { Buffer } from 'node:buffer';
// Resolve a document through Workspace permissions before reading its PDF.
// The caller cannot supply a remote URL or a NAS path.
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST');return res.status(405).json({error:'Metodo non consentito.'}); }
  const id = req.body?.document_id;
  if (typeof id !== 'string' || !/^[a-f0-9-]{36}$/i.test(id)) return res.status(400).json({error:'Documento non valido.'});
  try {
    const headers = {'Content-Type':'application/json'};
    if (req.headers.authorization) headers.Authorization = String(req.headers.authorization);
    const signal = AbortSignal.timeout(25000);
    const lookup = await fetch('https://workspace.progre.it/api/mexal/automation', {method:'POST',headers,body:JSON.stringify({action:'document_club_urls',ids:[id]}),signal});
    const data = await lookup.json();
    if (!lookup.ok) return res.status(lookup.status).json({error:'Documento non disponibile.'});
    const url = data.urls?.[id];
    if (!url || !url.startsWith('https://')) return res.status(404).json({error:'Documento non disponibile.'});
    const response = await fetch(url, {signal,redirect:'error'});
    if (!response.ok || !response.headers.get('content-type')?.toLowerCase().includes('application/pdf')) return res.status(415).json({error:'Anteprima disponibile solo per PDF.'});
    const reader = response.body.getReader(), chunks = [];
    let length = 0;
    while (true) {
      const {done,value} = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 20 * 1024 * 1024) { await reader.cancel();return res.status(413).json({error:'Apri il documento completo per consultare questo PDF.'}); }
      chunks.push(Buffer.from(value));
    }
    res.setHeader('Content-Type','application/pdf');
    res.setHeader('X-Content-Type-Options','nosniff');
    return res.status(200).send(Buffer.concat(chunks));
  } catch { return res.status(502).json({error:'Anteprima temporaneamente non disponibile. Puoi aprire il documento completo.'}); }
}
