import test from "node:test";
import assert from "node:assert/strict";
import { requirePermission } from "../server/mexal/lib/auth.js";
import { readFile } from "node:fs/promises";
const request = { headers: { authorization: "Bearer valid-token" } };
function client({admin=false,roleGrant=false,active=true,level="amministrazione",authError=null,permissionError=null}={}) {
 return {async rpc(name,args){assert.equal(name,"workspace_operation_codes");assert.deepEqual(args,{target_user_id:"profile"});return {data:roleGrant?["orders.delete"]:[],error:permissionError}},auth:{getUser:async()=>({data:{user:authError?null:{id:"auth-user"}},error:authError})},from(table){
 const q={select(){return q},eq(){return q},in(_column,codes){assert.deepEqual(codes,["orders.delete"]);return q},limit(){return q},
 async maybeSingle(){return table==="utenti"?{data:{id:"profile",attivo:active,ruoli:{amministratore_workspace:admin,livello_accesso:level}},error:null}:{data:roleGrant?{permessi:{codice:"orders.delete"}}:null,error:permissionError}}};return q;
 }};
}
const authorize=(c)=>requirePermission(request,c,"orders.delete",{explicitOnly:true});
test("admin conserva eliminazione ordini",async()=>assert.equal((await authorize(client({admin:true}))).id,"profile"));
test("il ruolo Direzione autorizza Noemi senza promozione ad admin",async()=>assert.equal((await authorize(client({roleGrant:true}))).id,"profile"));
test("un ruolo senza orders.delete non può eliminare",async()=>assert.rejects(()=>authorize(client()),{status:403}));
test("agente con sola scrittura non può eliminare",async()=>assert.rejects(()=>authorize(client({level:"scrittura"})),{status:403}));
test("utente disattivato non elimina anche con permesso del ruolo",async()=>assert.rejects(()=>authorize(client({roleGrant:true,active:false})),{status:403}));
test("sessione assente o non valida non elimina",async()=>{
 await assert.rejects(()=>requirePermission({headers:{}},client(),"orders.delete",{explicitOnly:true}),{status:401});
 await assert.rejects(()=>authorize(client({authError:new Error("expired")})),{status:401});
});
test("errore lettura permesso non autorizza eliminazione",async()=>assert.rejects(()=>authorize(client({permissionError:new Error("unavailable")})),{status:503}));
test("la modalità preesistente mantiene l’accesso amministrazione per le altre API",async()=>assert.equal((await requirePermission(request,client(),"orders.delete")).id,"profile"));
test("UI e API richiedono il medesimo permesso e la cancellazione resta locale a Workspace",async()=>{
 const api=await readFile("api/mexal/orders/delete.js","utf8"),ui=await readFile("src/modules/orders/pages/OrderDetail.jsx","utf8");
 assert.match(api,/requirePermission\(req, admin, "orders.delete", \{ explicitOnly: true \}\)/);
 assert.match(ui,/permissions.includes\("orders.delete"\)/);
 assert.match(ui,/I documenti già presenti in Mexal restano invariati/);
 assert.doesNotMatch(api,/buildMexalClient|deleteJson|postJson/);
});

test("migrazione associa il permesso al ruolo Direzione e non a un utente",async()=>{
 const sql=await readFile("supabase/migrations/20261006121000_order_deletion_role_permission.sql","utf8");
 assert.match(sql,/insert into public.permessi_ruolo/);
 assert.match(sql,/lower\(btrim\(r.nome\)\)='direzione'/);
 assert.doesNotMatch(sql,/permessi_utente|Noemi|Merino/);
});
