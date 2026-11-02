import {assert} from '../shared/orderPreparation.js';
import {unwrap} from './order-preparation-mexal.js';

export function createdDdtReference(creation,payload) {
  const document=unwrap(creation);
  if(Number(document?.numero)>0) return `BC+${payload.serie}+${Number(document.numero)}+${payload.cod_conto}`;
  const headers=creation?.mexalHttpResponse?.headers || {};
  const location=Object.entries(headers).find(([key])=>key.toLowerCase()==='location')?.[1];
  if(typeof location!=='string') return null;
  const path=new URL(location,'https://mexal.invalid').pathname;
  const prefix='/webapi/risorse/documenti/movimenti-magazzino/';
  assert(path.startsWith(prefix),'Riferimento di creazione Mexal non coerente.',502);
  const reference=decodeURIComponent(path.slice(prefix.length));
  const [signature,series,number,customer,...extra]=reference.split('+');
  assert(signature==='BC' && Number(series)===Number(payload.serie) && Number.isSafeInteger(Number(number)) && Number(number)>0 && (!customer || customer===payload.cod_conto) && !extra.length,'Documento creato diverso dalla BCF richiesta.',502);
  return `BC+${payload.serie}+${Number(number)}+${payload.cod_conto}`;
}
export async function readEmittedDdt({client,creation,payload,findExisting,wait=ms=>new Promise(resolve=>setTimeout(resolve,ms))}) {
  const reference=createdDdtReference(creation,payload);
  for(const delay of [0,1000,2500,5000,10000]) {
    if(delay) await wait(delay);
    try {
      const actual=reference
        ? unwrap(await client.getJson('/documenti/movimenti-magazzino/'+encodeURIComponent(reference)))
        : await findExisting();
      if(actual) return actual;
    } catch(error) {if(error.status!==404) throw error;}
  }
  return null;
}
