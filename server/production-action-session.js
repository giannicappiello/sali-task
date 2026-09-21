import { createClient } from "@supabase/supabase-js";
const fail = (message,status=400) => Object.assign(new Error(message),{status});
const check = (result) => {if(result.error)throw result.error;return result.data;};
export async function costSession(req,screen,write=false,{clientFactory=createClient}={}) {
 const token=String(req.headers?.authorization||"").replace(/^Bearer\s+/i,"");
 if(!token)throw fail("Sessione mancante.",401);
 const env=globalThis.process.env,options={auth:{persistSession:false,autoRefreshToken:false}};
 const admin=clientFactory(env.SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY,options);
 const auth=await admin.auth.getUser(token);
 if(auth.error||!auth.data?.user)throw fail("Sessione non valida.",401);
 const profile=check(await admin.from("utenti").select("id,attivo").eq("auth_user_id",auth.data.user.id).maybeSingle());
 if(!profile||!profile.attivo)throw fail("Profilo non attivo.",403);
 const caller=clientFactory(env.SUPABASE_URL,env.SUPABASE_ANON_KEY||env.SUPABASE_SERVICE_ROLE_KEY,{...options,global:{headers:{Authorization:`Bearer ${token}`}}});
 const [levelResult,scopeResult]=await Promise.all([
  admin.rpc("workspace_screen_level_for_user",{target_user_id:profile.id,target_screen:screen}),
  // The full session snapshot recalculates every screen permission. This
  // endpoint only needs the same caller-bound scope and the requested screen.
  caller.rpc("workspace_data_scope"),
 ]);
 const level=check(levelResult),scope=check(scopeResult);
 if(!level||level==="nessuno"||(write&&!["scrittura","gestione","completo","amministrazione"].includes(level)))throw fail("Operazione non autorizzata su questa schermata.",403);
 if(!scope?.mode)throw fail("Ambito dati non disponibile.",403);
 return {admin,caller,profile,scope,canWrite:["scrittura","gestione","completo","amministrazione"].includes(level)};
}
