import test from 'node:test';
import assert from 'node:assert/strict';
import {isConnectionError,connectionMessage}from'../apps/salidischia-club/src/networkErrors.js';
test('transient transport and gateway failures use readable Italian feedback',()=>{
for(const error of [new TypeError('Failed to fetch'),{message:'TypeError: Failed to fetch'},{message:'NetworkError when attempting to fetch resource.'},{message:'fetch failed'},...[502,503,504,522].map(status=>({status,message:'Gateway error'}))]){assert.equal(isConnectionError(error),true);assert.equal(connectionMessage(error),'Connessione al servizio momentaneamente non disponibile. Riprova tra poco.');}
});
test('permission, validation and rate-limit errors remain distinct',()=>{
for(const status of [401,403,409,422,429]){const error={status,message:'Operazione non autorizzata.'};assert.equal(isConnectionError(error),false);assert.equal(connectionMessage(error),error.message);}
assert.equal(isConnectionError({message:'Saldo insufficiente.'}),false);assert.equal(isConnectionError({message:'Cannot read properties of undefined'}),false);
});
