/* global process, Buffer */
import {createClient} from '@supabase/supabase-js';
import {createHash,createHmac,createCipheriv,createDecipheriv,randomBytes,randomUUID} from 'node:crypto';
export const ORIGIN='https://workspace.progre.it';
export const RESOURCE=ORIGIN+'/api/second-brain/mcp';
export const ISSUER=ORIGIN;
export const hash=value=>createHash('sha256').update(String(value)).digest('hex');
export const challenge=value=>createHash('sha256').update(value).digest('base64url');
export const fail=(message,status=400)=>Object.assign(new Error(message),{status});
const key=()=>createHmac('sha256',process.env.SUPABASE_SERVICE_ROLE_KEY||'').update('second-brain-online-session-v1').digest();
export function seal(value,aad){
 if(!process.env.SUPABASE_SERVICE_ROLE_KEY)throw fail('Collegamento non disponibile.',503);
 const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key(),iv);cipher.setAAD(Buffer.from(aad));
 const data=Buffer.concat([cipher.update(JSON.stringify(value)),cipher.final()]);return [iv,cipher.getAuthTag(),data].map(x=>x.toString('base64url')).join('.');
}
export function unseal(value,aad){const [iv,tag,data]=value.split('.').map(x=>Buffer.from(x,'base64url'));const decipher=createDecipheriv('aes-256-gcm',key(),iv);decipher.setAAD(Buffer.from(aad));decipher.setAuthTag(tag);return JSON.parse(Buffer.concat([decipher.update(data),decipher.final()]).toString());}
export const adminClient=()=>createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
export const check=result=>{if(result.error)throw fail('Collegamento non disponibile.',503);return result.data;};
const CLIENTS=new Set(['https://chatgpt.com/oauth/client.json','https://chatgpt.com/oauth/codex/client.json']);
const metadataCache=new Map();
export function validRedirect(value){
 try{const u=new URL(value);if(u.username||u.password||u.hash||u.search)return false;
 return (u.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(u.hostname)&&/^\/callback(?:\/[A-Za-z0-9_-]+)?$/.test(u.pathname))||(u.origin==='https://chatgpt.com'&&(u.pathname==='/connector_platform_oauth_redirect'||/^\/connector\/oauth\/[A-Za-z0-9_-]+$/.test(u.pathname)));
 }catch{return false;}
}
export function redirectMatches(registered,actual){
 if(!validRedirect(registered)||!validRedirect(actual))return false;
 const a=new URL(registered),b=new URL(actual);
 if(a.protocol==='http:'){a.port='';b.port='';}return a.href===b.href;
}
export async function clientMetadata(id,transport=fetch){
 if(!CLIENTS.has(id))throw fail('Client OAuth non supportato.',400);
 const cached=metadataCache.get(id);if(cached?.until>Date.now())return cached.value;
 const response=await transport(id,{redirect:'error',signal:AbortSignal.timeout(10000)});
 if(!response.ok)throw fail('Identita del client OpenAI non verificabile.',503);
 const text=await response.text();if(text.length>30000)throw fail('Metadati client non validi.');const value=JSON.parse(text);
 if(value.client_id!==id||!Array.isArray(value.redirect_uris)||value.redirect_uris.length>20||value.redirect_uris.some(x=>!validRedirect(x)))throw fail('Metadati client non validi.');
 metadataCache.set(id,{value,until:Date.now()+300000});return value;
}
export async function authorizationInput(input){
 if(input.response_type!=='code'||input.code_challenge_method!=='S256'||!/^[A-Za-z0-9_-]{43}$/.test(input.code_challenge||'')||typeof input.state!=='string'||input.state.length>2000||input.resource!==RESOURCE)throw fail('Richiesta di collegamento non valida.');
 const scopes=String(input.scope||'second_brain').split(/\s+/).filter(Boolean);if(scopes.some(x=>!['second_brain','offline_access'].includes(x)))throw fail('Ambito non supportato.');
 const metadata=await clientMetadata(input.client_id);
 if(!metadata.redirect_uris.some(uri=>redirectMatches(uri,input.redirect_uri)))throw fail('Destinazione OAuth non autorizzata.');
 return {client_id:input.client_id,redirect_uri:input.redirect_uri,response_type:'code',code_challenge:input.code_challenge,code_challenge_method:'S256',state:input.state,resource:RESOURCE,scope:scopes.join(' ')};
}
export async function grantConnection(auth,input,refreshToken){
 const verified=await authorizationInput(input);if(typeof refreshToken!=='string'||refreshToken.length<16||refreshToken.length>4000)throw fail('Accedi personalmente per collegare Codex.');
 const claims=JSON.parse(Buffer.from(auth.token.split('.')[1],'base64url').toString()),id=randomUUID();
 const aad=id+'|'+auth.profile.id+'|'+verified.client_id;
 check(await auth.admin.from('second_brain_connections').insert({id,user_id:auth.profile.id,auth_user_id:claims.sub,client_id:verified.client_id,session_sealed:seal({accessToken:auth.token,refreshToken,authUserId:claims.sub},aad),session_expires_at:new Date(claims.exp*1000).toISOString()}));
 const code=randomBytes(32).toString('base64url');
 check(await auth.admin.from('second_brain_oauth_codes').insert({hash:hash(code),connection_id:id,challenge:verified.code_challenge,redirect_uri:verified.redirect_uri,resource:RESOURCE}));
 const target=new URL(verified.redirect_uri);target.searchParams.set('code',code);target.searchParams.set('state',verified.state);target.searchParams.set('iss',ISSUER);return target.href;
}
export async function exchangeToken(body,admin=adminClient()){
 if(!CLIENTS.has(body.client_id)||body.resource!==RESOURCE)throw fail('invalid_target');
 if(!['authorization_code','refresh_token'].includes(body.grant_type))throw fail('unsupported_grant_type');
 if(body.grant_type==='authorization_code'&&(!/^[A-Za-z0-9._~-]{43,128}$/.test(body.code_verifier||'')||!validRedirect(body.redirect_uri)))throw fail('invalid_grant');
 const credential=body.grant_type==='authorization_code'?body.code:body.refresh_token;
 if(typeof credential!=='string'||credential.length>200)throw fail('invalid_grant');
 const access=randomBytes(32).toString('base64url'),refresh=randomBytes(32).toString('base64url');
 const result=await admin.rpc('second_brain_exchange_oauth',{p_grant:body.grant_type,p_hash:hash(credential),p_client:body.client_id,p_redirect:body.redirect_uri||'',p_challenge:body.code_verifier?challenge(body.code_verifier):'',p_resource:RESOURCE,p_access_hash:hash(access),p_refresh_hash:hash(refresh)});
 if(result.error)throw fail('invalid_grant');return {access_token:access,refresh_token:refresh,token_type:'Bearer',expires_in:900,scope:'second_brain offline_access'};
}
export async function remoteSession(bearer,admin=adminClient(),transport=fetch){
 if(!/^[A-Za-z0-9_-]{43}$/.test(bearer||''))throw fail('Collegamento richiesto.',401);
 const token=check(await admin.from('second_brain_oauth_tokens').select('connection_id,expires_at,consumed_at').eq('hash',hash(bearer)).eq('kind','access').maybeSingle());
 if(!token||token.consumed_at||Date.parse(token.expires_at)<=Date.now())throw fail('Collegamento scaduto.',401);
 let connection=check(await admin.from('second_brain_connections').select('*').eq('id',token.connection_id).maybeSingle());
 if(!connection||connection.revoked_at||Date.parse(connection.expires_at)<=Date.now())throw fail('Collegamento revocato.',401);
 const aad=connection.id+'|'+connection.user_id+'|'+connection.client_id;
 let session=unseal(connection.session_sealed,aad);
 if(Date.parse(connection.session_expires_at)<Date.now()+90000){
  const lock=randomUUID();
  const owned=check(await admin.from('second_brain_connections').update({refresh_lock:lock,refresh_lock_until:new Date(Date.now()+30000).toISOString()}).eq('id',connection.id).is('revoked_at',null).or(`refresh_lock_until.is.null,refresh_lock_until.lt.${new Date().toISOString()}`).select('*').maybeSingle());
  if(!owned)throw fail('Aggiornamento collegamento in corso. Riprovare.',503);
  connection=owned;session=unseal(connection.session_sealed,aad);
  try{
   // A distinct Supabase login session is created during consent. It is never
   // shared with the browser's normal Workspace session or another connection.
   if(Date.parse(connection.session_expires_at)<Date.now()+90000){
    const response=await transport(process.env.SUPABASE_URL+'/auth/v1/token?grant_type=refresh_token',{method:'POST',redirect:'error',signal:AbortSignal.timeout(20000),headers:{apikey:process.env.SUPABASE_ANON_KEY||process.env.VITE_SUPABASE_ANON_KEY,'Content-Type':'application/json'},body:JSON.stringify({refresh_token:session.refreshToken})});
    if(!response.ok)throw fail('Ripetere il collegamento personale.',401);const fresh=await response.json();
    if(fresh.user?.id!==connection.auth_user_id||!fresh.access_token||!fresh.refresh_token)throw fail('Identita del collegamento non valida.',401);
    session={accessToken:fresh.access_token,refreshToken:fresh.refresh_token,authUserId:fresh.user.id};
    check(await admin.from('second_brain_connections').update({session_sealed:seal(session,aad),session_expires_at:new Date(Date.now()+fresh.expires_in*1000).toISOString()}).eq('id',connection.id).eq('refresh_lock',lock).is('revoked_at',null));
   }
  }finally{await admin.from('second_brain_connections').update({refresh_lock:null,refresh_lock_until:null}).eq('id',connection.id).eq('refresh_lock',lock);}
 }
 if(session.authUserId!==connection.auth_user_id)throw fail('Identita del collegamento non valida.',401);
 return {token:session.accessToken,userId:connection.user_id,connectionId:connection.id};
}
