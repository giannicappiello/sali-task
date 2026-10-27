import { mkdir,writeFile } from 'node:fs/promises';
import { pinnedFetch } from '../src/pinned-fetch.mjs';
const env=process.env;
const base=new URL(env.MEXAL_BASE_URL);
const request=pinnedFetch(base.origin,env.MEXAL_CERT_SHA256);
const auth=Buffer.from(`${env.MEXAL_USERNAME}:${env.MEXAL_PASSWORD}`).toString('base64');
const headers={Authorization:`Passepartout ${auth}`,'Coordinate-Gestionale':`Azienda=${env.MEXAL_AZIENDA} Anno=${env.MEXAL_ANNO} Magazzino=${env.MEXAL_MAGAZZINO}`,Accept:'application/json'};
await mkdir('.private',{recursive:true});
for(const [name,path]of [['help','/webapi/HELP'],['clienti','/webapi/risorse/clienti?max=1&info=true'],['ordini','/webapi/risorse/documenti/ordini-clienti?max=1&info=true']]){
 try{
  const r=await request(new URL(path,base),{headers,signal:AbortSignal.timeout(45000)});
  const parts=[];let length=0;for await(const part of r.body){length+=part.length;if(length>8*1024*1024)throw new Error('Risposta troppo grande');parts.push(part);}
  const raw=Buffer.concat(parts).toString('utf8');await writeFile(`.private/probe-${name}.json`,raw);
  let result;try{result=JSON.parse(raw);}catch{result={};}
  const error=result.error;
  let message=error?.['response-message']||error?.['response-detail']||'';
  for(const secret of [env.MEXAL_PASSWORD,auth])if(secret)message=message.replaceAll(secret,'[omesso]');
  console.log(JSON.stringify({name,status:r.status,keys:Object.keys(result),message}));
 }catch(error){console.log(JSON.stringify({name,error:error.code||error.message}));}
}
