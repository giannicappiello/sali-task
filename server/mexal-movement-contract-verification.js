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
  const shapes=[];
  const shape=value=>Array.isArray(value)?value.slice(0,2).map(shape):value===null?'null':typeof value==='object'?Object.fromEntries(Object.entries(value).map(([key,item])=>[key,shape(item)])):typeof value;
  try {
    const listing=await client.getJson('/documenti/movimenti-magazzino?max=20');
    const rows=Array.isArray(listing)?listing:listing.dati||[];
    shapes.push({kind:'collection',keys:Object.keys(listing),rowKeys:rows[0]?Object.keys(rows[0]):[]});
    for (const type of ['SL','CL']) {
      const row=rows.find(row=>row.sigla===type);
      if(!row){shapes.push({type,found:false});continue;}
      const reference=[row.sigla,row.serie,row.numero].join('+')+(row.cod_conto?'+'+row.cod_conto:'');
      const detail=await client.getJson('/documenti/movimenti-magazzino/'+encodeURIComponent(reference));
      shapes.push({type,found:true,keys:Object.keys(detail),reason:shape(detail.id_causale),note:shape(detail.nota)});
    }
  }catch(error){shapes.push({error:'Existing movement shapes could not be read',status:error.status||client.lastHttpStatus||null});}
  return res.status(200).json({mode:'read-only technical help',results,shapes});
}
