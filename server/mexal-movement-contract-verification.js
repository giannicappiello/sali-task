import { buildMexalClient } from './mexal/sync-products.js';

// Temporary technical verification, restricted to preview deployments and GET help.
export default async function movementContractVerification(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (process.env.VERCEL_ENV !== 'preview' || req.method !== 'GET') return res.status(404).json({error:'Unavailable'});
  const client = buildMexalClient({timeoutMs:20000});
  const resources = ['/documenti/movimenti-magazzino?info=true'];
  const results = [];
  for (const resource of resources) {
    try {
      const help = await client.getJson(resource);
      const fields = [];
      function visit(value,path='') {
        if(!value || typeof value !== 'object')return;
        if (['id_causale','nota'].includes(value.nome)) { fields.push({path,value}); return; }
        for(const [key,child]of Object.entries(value)) {
          const childPath=path?`${path}.${key}`:key;
          if(/causale|^nota$|^note$/i.test(key) || (typeof child === 'string' && /\b(id_causale|nota|note)\b|movimenti-magazzino/i.test(child))) fields.push({path:childPath,value:child});
          if(child && typeof child === 'object')visit(child,childPath);
        }
      }
      visit(help);
      results.push({resource,status:client.lastHttpStatus,rootKeys:Object.keys(help),fields});
    } catch(error) {
      results.push({resource,status:error.status||client.lastHttpStatus||null,error:'Help resource could not be read'});
    }
  }
  return res.status(200).json({mode:'read-only technical help',results});
}
