import test from 'node:test';
import assert from 'node:assert/strict';
import { productionOverviewAccess } from './productionOverviewAccess.js';
test('department operators see only their own overview, administrators both',()=>{
 assert.deepEqual(productionOverviewAccess({role:'Addetto miscelazione',planning:true}),{station:true,filling:false});
 assert.deepEqual(productionOverviewAccess({role:'Addetto confezionamento',planning:true}),{station:false,filling:true});
 assert.deepEqual(productionOverviewAccess({admin:true}),{station:true,filling:true});
 assert.deepEqual(productionOverviewAccess({departments:['Confezionamento']}),{station:false,filling:true});
 assert.deepEqual(productionOverviewAccess({areas:['miscelazione']}),{station:true,filling:false});
 assert.deepEqual(productionOverviewAccess({customer:true,planning:true}),{station:false,filling:false});
 assert.deepEqual(productionOverviewAccess(),{station:false,filling:false});
});
