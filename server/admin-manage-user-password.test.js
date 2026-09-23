import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../supabase/functions/admin-manage-user/Index.ts',import.meta.url),'utf8');
const update=source.slice(source.indexOf('async function updateUser('),source.indexOf('async function saveCustomerLink('));
async function run({target={auth_user_id:'canonical'},lookupError=null,authError=null,clientId, password='example-pass'}={}) {
 const calls=[];
 const client={from(){return {select(){return {eq(){return {async maybeSingle(){return {data:target,error:lookupError}}}}}},update(){calls.push('profile');return {async eq(){return {error:null}}}}}},auth:{admin:{async updateUserById(id,payload){calls.push({id,password:payload.password});return {error:authError}}}}};
 const context=vm.createContext({clean:v=>String(v||'').trim(),json:(body,status=200)=>({body,status})});
 vm.runInContext(update+'; globalThis.update=updateUser;',context);
 const result=await context.update(client,{id:'profile',auth_user_id:clientId,nome:'Test',cognome:'User',email:'test@example.invalid',password,defer_access_update:true},'admin');
 return {result,calls};
}
test('password reset resolves canonical account when browser omits auth id',async()=>{const {result,calls}=await run();assert.equal(result.status,200);assert.equal(calls[0].id,'canonical');assert.equal(calls[0].password,'example-pass');});
test('browser cannot redirect reset to another account',async()=>{const {calls}=await run({clientId:'wrong-account'});assert.equal(calls[0].id,'canonical');});
test('unlinked account fails without saving profile',async()=>{const {result,calls}=await run({target:{auth_user_id:null}});assert.equal(result.status,409);assert.equal(calls.length,0);});
test('missing target fails without saving',async()=>{const {result,calls}=await run({target:null});assert.equal(result.status,404);assert.equal(calls.length,0);});
test('authentication update error is propagated before profile save',async()=>{const {result,calls}=await run({authError:{message:'Rejected'}});assert.equal(result.status,400);assert.equal(result.body.error,'Rejected');assert.equal(calls.length,1);});
test('empty password preserves password while editing profile',async()=>{const {result,calls}=await run({password:''});assert.equal(result.status,200);assert.equal(calls[0].password,undefined);});
