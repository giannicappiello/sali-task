import process from 'node:process';
import { signedUrl, filePath } from './document-gateway.js';
let cache;
export async function loadNasProductPhotos(fetcher = fetch) {
 const key=process.env.DOCUMENT_GATEWAY_URL;
 if(!cache||cache.key!==key||cache.expires<Date.now()){
  const response=await fetcher(signedUrl('/product-photos'),{signal:AbortSignal.timeout(300000)});
  if(!response.ok)throw Object.assign(new Error('Archivio foto originali NAS non disponibile.'),{status:502});
  const data=await response.json();
  if(!Array.isArray(data.photos))throw Object.assign(new Error('Indice foto NAS non valido.'),{status:502});
  cache={key,expires:Date.now()+60000,photos:data.photos.filter(p=>/^(IT|MKT)[A-Z0-9_-]+$/.test(p.code)&&['png','jpg','jpeg','webp'].some(ext=>String(p.path).toUpperCase()===('FotoProdotti/'+p.code+'.'+ext).toUpperCase()))};
 }
 return cache.photos.map(p=>({...p,url:signedUrl(filePath(p.path))}));
}

export async function loadNasBrandLogo(fetcher = fetch) {
 const response=await fetcher(signedUrl('/product-logo'),{signal:AbortSignal.timeout(300000)});
 if(response.status===404)return {available:false};
 if(!response.ok)throw Object.assign(new Error('Logo originale NAS non disponibile.'),{status:502});
 return {available:true,pdfUrl:signedUrl(filePath('FotoProdotti/Salidischia.pdf')),previewUrl:signedUrl(filePath('FotoProdotti/Salidischia-preview.png'))};
}
