import https from 'node:https';
import tls from 'node:tls';
import { timingSafeEqual } from 'node:crypto';

export function verifyPinnedCertificate(cert, expected, now=Date.now()) {
  const actual=String(cert?.fingerprint256||'').replaceAll(':','').toUpperCase();
  const wanted=String(expected||'').replaceAll(':','').toUpperCase();
  if(!/^[A-F0-9]{64}$/.test(actual)||!/^[A-F0-9]{64}$/.test(wanted)||!timingSafeEqual(Buffer.from(actual,'hex'),Buffer.from(wanted,'hex')))throw new Error('Certificato Mexal diverso dall’impronta autorizzata.');
  const start=Date.parse(cert.valid_from),end=Date.parse(cert.valid_to);
  if(!Number.isFinite(start)||!Number.isFinite(end)||now<start||now>end)throw new Error('Certificato Mexal non valido alla data corrente.');
}

// TLS completes and the exact authorized certificate is checked BEFORE the
// socket is handed to the HTTP request; credentials cannot precede the check.
export function pinnedFetch(origin,fingerprint) {
  const allowed=new URL(origin);
  if(allowed.protocol!=='https:')throw new Error('Il pin richiede HTTPS.');
  const agent=new https.Agent({keepAlive:false});
  agent.createConnection=(options,callback)=>{
    const socket=tls.connect({host:allowed.hostname,port:Number(allowed.port||443),servername:allowed.hostname,rejectUnauthorized:false});
    let completed=false;
    const done=(error)=>{if(completed)return;completed=true;if(error){socket.destroy();callback(error);}else callback(null,socket);};
    socket.once('error',done);
    socket.once('secureConnect',()=>{try{verifyPinnedCertificate(socket.getPeerCertificate(),fingerprint);done();}catch(error){done(error);}});
    return undefined;
  };
  return (value,options={})=>new Promise((resolve,reject)=>{
    const url=new URL(value);
    if(url.origin!==allowed.origin){reject(new Error('Il certificato è autorizzato per un solo endpoint Mexal.'));return;}
    const request=https.request(url,{agent,method:options.method||'GET',headers:options.headers,signal:options.signal},response=>{
      const headers=new Headers();for(const [name,value]of Object.entries(response.headers))if(value!==undefined)headers.set(name,Array.isArray(value)?value.join(', '):value);
      resolve({ok:response.statusCode>=200&&response.statusCode<300,status:response.statusCode,headers,body:response});
    });
    request.once('error',reject);if(options.body!==undefined)request.write(options.body);request.end();
  });
}
