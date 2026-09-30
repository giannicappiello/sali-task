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

import {productionOverviewKind} from './productionOverviewAccess.js';
test('department grants are limited to exact overview destinations',()=>{
 assert.equal(productionOverviewKind('/produzione/miscelazione'),'station');
 assert.equal(productionOverviewKind('/produzione/filling'),'filling');
 assert.equal(productionOverviewKind('/produzione/progremes.PlanningProduction?destination=station-overview&workspaceMesWindow=1'),'station');
 assert.equal(productionOverviewKind('/produzione/progremes.PlanningProduction?destination=filling-overview'),'filling');
 for(const path of ['/produzione','/produzione/progremes.PlanningProduction','/produzione/progremes.PlanningProduction?destination=station&station=ST7','/produzione/progremes.Settings','https://external.invalid/produzione/filling']) assert.equal(productionOverviewKind(path),'');
 const mixing=productionOverviewAccess({role:'Addetto miscelazione'});
 assert.equal(mixing[productionOverviewKind('/produzione/filling')],false);
 const packaging=productionOverviewAccess({role:'Addetto confezionamento'});
 assert.equal(packaging[productionOverviewKind('/produzione/miscelazione')],false);
});
