import test from 'node:test';
import assert from 'node:assert/strict';
import {deliveryDestination} from '../server/order-preparation-mexal.js';

const party={codice:'501.02490',ragione_sociale:'Leone Melania',cod_ind_sped:'1067',indirizzo:'Corso Vittorio Emanuele, 36',cap:'76016',localita:'MARGHERITA DI SAVOIA',provincia:'BT'};

test('customer anagraphic destination uses its verified client address, not the unrelated separate-address archive',async()=>{
 const reads=[];
 const client={getJson:async path=>{reads.push(path);assert.equal(path,'/clienti/501.02490');return structuredClone(party);}};
 const actual=await deliveryDestination(client,{id_ind_sped:[],cod_anag_sped:[[1,'1067']]},party.codice);
 assert.equal(actual.code,'1067');assert.equal(actual.address,party.indirizzo);assert.equal(actual.city,party.localita);
 assert.deepEqual(reads,['/clienti/501.02490']);
 const cached=await deliveryDestination({getJson:async()=>assert.fail('unnecessary read')},{cod_anag_sped:[[1,'1067']]},party.codice,party);
 assert.deepEqual(cached,actual);
});

test('an explicit separate destination retains precedence and is rejected for another customer',async()=>{
 const raw={id_ind_sped:[[1,77]],cod_anag_sped:[[1,'1067']]};
 const client={getJson:async path=>{assert.equal(path,'/indirizzi-spedizione/77');return {id:[[1,77]],cod_conto:[[1,party.codice]],descrizione:'Deposito',indirizzo:'Via deposito 1'};}};
 assert.equal((await deliveryDestination(client,raw,party.codice,party)).address,'Via deposito 1');
 await assert.rejects(deliveryDestination({getJson:async()=>({id:77,cod_conto:'501.99999',indirizzo:'Altra destinazione'})},raw,party.codice,party),/non coerente/);
 await assert.rejects(deliveryDestination({getJson:async()=>({id:88,cod_conto:party.codice,indirizzo:'Altra destinazione'})},raw,party.codice,party),/non coerente/);
});

test('a different anagraphic reference cannot silently fall back to billing and no reference uses the customer address',async()=>{
 const client={getJson:async path=>{assert.equal(path,'/indirizzi-spedizione/99');return {id:99,cod_conto:party.codice,indirizzo:'Via alternativa 2'};}};
 assert.equal((await deliveryDestination(client,{cod_anag_sped:[[1,99]]},party.codice,party)).address,'Via alternativa 2');
 await assert.rejects(deliveryDestination({getJson:async()=>({id:99,cod_conto:'501.99999',indirizzo:'Altro cliente'})},{cod_anag_sped:[[1,99]]},party.codice,party),/non coerente/);
 assert.equal((await deliveryDestination({}, {},party.codice,party)).code,'');
 await assert.rejects(deliveryDestination({}, {},party.codice,{...party,codice:'501.99999'}),/diversa dal cliente/);
});
