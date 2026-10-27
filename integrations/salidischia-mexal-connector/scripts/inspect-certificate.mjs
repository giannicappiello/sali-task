import tls from 'node:tls';
import { mkdir,writeFile } from 'node:fs/promises';
// Certificate discovery only: no HTTP request, credentials, or business data.
const url=new URL(process.env.MEXAL_BASE_URL);
const socket=tls.connect({host:url.hostname,port:Number(url.port||443),servername:url.hostname,rejectUnauthorized:false});
socket.setTimeout(10000,()=>socket.destroy(new Error('Timeout certificato')));
socket.on('secureConnect',async()=>{
  try {
    const cert=socket.getPeerCertificate();
    const identity=tls.checkServerIdentity(url.hostname,cert);
    const pem='-----BEGIN CERTIFICATE-----\n'+cert.raw.toString('base64').match(/.{1,64}/g).join('\n')+'\n-----END CERTIFICATE-----\n';
    await mkdir('.private',{recursive:true});await writeFile('.private/mexal-server-candidate.pem',pem);
    console.log(JSON.stringify({host:url.hostname,fingerprint256:cert.fingerprint256,subject:cert.subject,issuer:cert.issuer,validFrom:cert.valid_from,validTo:cert.valid_to,hostnameValid:!identity,trustError:socket.authorizationError}));
  }catch(error){console.error(error.message);process.exitCode=1;}
  finally{socket.end();}
});
socket.on('error',error=>{console.error(error.code||error.message);process.exitCode=1;});
