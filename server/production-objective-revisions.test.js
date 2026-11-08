import test from 'node:test';
import assert from 'node:assert/strict';
import {stationObjective,formulaObjectiveBasis} from '../src/features/production-costs/station-objective.js';
import {objectivePreview,readObjectivePreview} from './production-objective-revisions.js';
import {calculateRecord,defaultSettings} from '../src/features/production-costs/cost-engine.js';
import {latestCostAdjustment} from '../src/features/production-costs/overtime.js';
import {reportPage} from './second-brain/production-report-reads.js';
const timing={formulaVersionId:10,productionHours:16,phaseMinutes:0,operations:[{type:'Production',impiantoId:8,lotCount:1,durationMinutes:1080}]};
const config={id:'c',effective_from:'2026-01-01',settings:{...defaultSettings(),laborHourly:20,machines:[{id:8,gainPerWork:600}]}};
const evidence={id:1,orderNumber:'RDP1',date:'2026-09-01',baseline:{capturedAt:'2026-09-01',plannedTiming:timing},works:[{id:10,machineId:8,phase:'Semilavorato',state:'Terminato',start:'2026-09-07T08:00:00',end:'2026-09-08T16:00:00'}]};
const row={mes_order_id:1,configuration_id:'c',evidence};
test('ST4 600 / two formula shifts = 300; actual shifts cannot multiply total',()=>{
 const record={...evidence,phases:evidence.works,plannedObjective:600};
 assert.equal(stationObjective(record).plannedObjectivePerTurn,300);
 assert.equal(stationObjective({...record,phases:[{...record.phases[0],actualTurns:99,plannedTurns:77}]}).plannedObjectivePerTurn,300);
 assert.equal(stationObjective({...record,plannedObjective:1500}).plannedObjectivePerTurn,750);
});
test('invalid or ambiguous formula inputs remain null; phase minutes and lots have explicit units',()=>{
 for(const value of [null,0,-1,'',NaN])assert.equal(formulaObjectiveBasis({...evidence,baseline:{plannedTiming:{...timing,productionHours:value}}},8).turns,null);
 assert.equal(formulaObjectiveBasis({...evidence,baseline:{plannedTiming:{...timing,productionHours:0,phaseMinutes:240}}},8).turns,.5);
 assert.equal(formulaObjectiveBasis({...evidence,baseline:{plannedTiming:{...timing,productionHours:12,operations:[{...timing.operations[0],lotCount:2}]}}},8).turns,3);
 assert.equal(stationObjective({...evidence,phases:[...evidence.works,{machineId:9,phase:'Semilavorato'}],plannedObjective:600}).plannedObjectivePerTurn,null);
});
test('preview is deterministic, no source mutation, excludes reconstructed historical duration',()=>{
 const input=structuredClone([row,{...row,mes_order_id:2,evidence:{...evidence,id:2,baseline:null,plannedTiming:timing}}]);
 const before=JSON.stringify(input),p=objectivePreview(input,[config],[]);
 assert.equal(JSON.stringify(input),before);assert.equal(p.summary.eligible,1);assert.equal(p.summary.excluded,1);
 assert.equal(p.items[0].after.plannedObjectivePerTurn,300);assert.equal(p.items[0].difference.objectiveTotal,0);
 assert.deepEqual(p.items[0].backup.evidence,evidence);assert.equal(p.snapshot,objectivePreview(input,[config],[]).snapshot);
 assert.notEqual(p.snapshot,objectivePreview(input,[{...config,settings:{...config.settings,machines:[{id:8,gainPerWork:601}]}}],[]).snapshot);
});
test('closed historical values appear only from an approved append-only revision; UI and Second Brain agree',()=>{
 const before=calculateRecord(evidence,config);assert.equal(before.plannedObjectivePerTurn,null);assert.equal(before.plannedObjective,600);
 const p=objectivePreview([row],[config],[]),revision=p.items[0].after;
 const audit=[{id:'a',created_at:'2026-11-08',details:{objectiveRevision:revision,objectiveActionId:'x',objectiveBackup:p.items[0].backup},mes_order_id:1}];
 const r=calculateRecord(evidence,config,latestCostAdjustment(audit));assert.equal(r.plannedObjectivePerTurn,300);assert.equal(r.plannedObjective,600);
 assert.equal(reportPage([r]).rows[0].plannedObjectivePerTurn,300);
 const rollback=objectivePreview([row],[config],audit,{rollbackOf:'x'});assert.equal(rollback.items[0].after,null);
 const newer=[{...audit[0],id:'b',created_at:'2026-11-09',details:{objectiveRevision:revision,objectiveActionId:'y'}},...audit];
 assert.equal(objectivePreview([row],[config],newer,{rollbackOf:'x'}).summary.eligible,0);
});
test('preview never expands restricted scopes or writes when permissions are missing',async()=>{
 let reads=0;
 await assert.rejects(readObjectivePreview({}, {},{sessionFactory:async()=>({scope:{mode:'propri'},admin:{from(){reads++;}}})}),e=>e.status===403);
 assert.equal(reads,0);
 await assert.rejects(readObjectivePreview({}, {},{sessionFactory:async()=>{throw Object.assign(Error('denied'),{status:403});}}),e=>e.status===403);
});
