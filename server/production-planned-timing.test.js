import test from 'node:test';
import assert from 'node:assert/strict';
import {forecastOperations} from '../src/features/production-costs/planned-timing.js';
import {calculateRecord,defaultSettings} from '../src/features/production-costs/cost-engine.js';
const calendar={shifts:[{start:'07:30',end:'16:30',days:[1,2,3,4,5],breakMinutes:0}],closures:[]};
const timing={schema:1,source:'Formula collegata',calendar,operations:[{impiantoId:1,type:'Production',durationMinutes:1080,lotCount:1,quantity:15000,operators:1}]};
const work={id:1,machineId:1,phase:'Semilavorato',state:'Terminato',start:'2026-09-07T09:00:00',end:'2026-09-07T09:09:14',goodQuantity:15000,personnel:[]};
const evidence={date:'2026-09-07',unit:'KG',quantity:15000,plannedTiming:timing,works:[work],operations:[{impiantoId:1,type:'Production',start:work.start,end:work.end}]};
const settings={...defaultSettings(),shifts:calendar.shifts,laborHourly:40,mixingOperatorsCount:3};
test('formula 16 productive hours occupy two full MES shifts, regardless of actual nine-minute work',()=>{
 const ops=forecastOperations(evidence).operations;assert.equal(ops[0].start,'2026-09-07T07:30:00');assert.equal(ops[0].end,'2026-09-08T16:30:00');
 const r=calculateRecord(evidence,{settings});assert.equal(r.phases[0].plannedHours,18);assert.equal(r.phases[0].plannedTurns,2);assert.ok(r.phases[0].actualHours<0.16);
 const changed=calculateRecord({...evidence,works:[{...work,end:'2026-09-10T16:30:00'}],operations:[]},{settings});assert.equal(changed.phases[0].plannedHours,18);assert.equal(changed.phases[0].plannedTurns,2);
});
test('weekends and closures do not add machine hours or overtime; lots each retain duration',()=>{
 const e={...evidence,date:'2026-09-11',plannedTiming:{...timing,calendar:{...calendar,closures:[{from:'2026-09-14',to:'2026-09-14'}]},operations:[{...timing.operations[0],durationMinutes:540,lotCount:2}]}};
 const ops=forecastOperations(e).operations;assert.equal(ops.length,2);assert.equal(ops[1].start,'2026-09-15T07:30:00');assert.equal(ops[0].durationMinutes+ops[1].durationMinutes,1080);
});
test('historical planning timestamps are never a fallback and frozen timing wins',()=>{
 assert.deepEqual(forecastOperations({...evidence,plannedTiming:null,historicalBaseline:{operations:evidence.operations}}).operations,[]);
 assert.equal(forecastOperations({...evidence,baseline:{plannedTiming:{...timing,operations:[{...timing.operations[0],durationMinutes:60}]}}}).operations[0].durationMinutes,60);
 assert.deepEqual(forecastOperations({...evidence,plannedTiming:{...timing,operations:[{...timing.operations[0],durationMinutes:null}]}}).operations,[]);
});
test('filling forecast uses independent scaled duration and does not change historical piece costs',()=>{
 const e={...evidence,unit:'PZ',plannedTiming:{...timing,operations:[{impiantoId:1,type:'Packaging',durationMinutes:120,lotCount:1,operators:2,quantity:1000}]},works:[{...work,phase:'Confezionamento'}]};
 const r=calculateRecord(e,{settings});assert.equal(r.phases[0].plannedHours,2);assert.equal(r.phases[0].plannedPersonHours,4);
});
