import test from 'node:test';
import assert from 'node:assert/strict';
import { verifiedOperationalAnswer } from './operational-outcome.js';
const output=(tool,state,result,error)=>({controlledAction:{id:'a',tool,state,result,error}});
test('model cannot turn a missing CL or pending start into success',()=>{
 const closure=output('MES_PRODUCTION_RESUME_CLOSE','failed',{verified:true,applied:false,message:'SL creato; CL non creato.'},'MP2343: lotti mancanti nel magazzino 1.');
 assert.equal(verifiedOperationalAnswer('Tutto completato',[closure]),closure.controlledAction.error);
 assert.match(verifiedOperationalAnswer('Avviato',[output('MES_PRODUCTION_START','confirmed',{printJobId:'p'})]),/non ancora verificato/);
 assert.doesNotMatch(verifiedOperationalAnswer('Avviato',[output('MES_PRODUCTION_START','executed',{applied:true,verified:false})]),/^Avviato/);
});
test('latest persisted result replaces the pending result of the same action',()=>{
 const pending=output('MES_PRODUCTION_START','confirmed',{});
 const complete=output('MES_PRODUCTION_START','executed',{applied:true,verified:true,phaseStatus:'RUNNING'});
 assert.equal(verifiedOperationalAnswer('done',[pending,complete]),'Produzione avviata: in lavorazione.');
 const closed=output('MES_PRODUCTION_RESUME_CLOSE','executed',{applied:true,verified:true,message:'SL conservato; CL creato. Lavorazione chiusa.'});
 assert.equal(verifiedOperationalAnswer('done',[closed]),closed.controlledAction.result.message);
 assert.equal(verifiedOperationalAnswer('Confermare il consuntivo',[output('MES_PRODUCTION_RESUME_CLOSE','proposed',{})]),'Confermare il consuntivo');
});
