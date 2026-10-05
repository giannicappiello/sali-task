import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateMaterialActuals } from './packagingMaterialActuals.js';

test('bulk and packaging consumption scale with output; whole cartons round up', () => {
  const current={ returned: 2, wasted: 1 };
  assert.deepEqual(calculateMaterialActuals({required:300,unit:'KG'},3001,6000,current),
    {consumed:150.05,returned:2,wasted:1,deposited:153.05});
  assert.equal(calculateMaterialActuals({required:6000,unit:'PZ'},3001,6000,current).consumed,3001);
  assert.equal(calculateMaterialActuals({required:60,unit:'PZ'},3001,6000,current).consumed,31);
});
test('manual consumption survives a changed output and deposits update from actual values', () => {
  const current={ consumed:148.75,returned:10,wasted:1 };
  assert.deepEqual(calculateMaterialActuals({required:300,unit:'KG'},4000,6000,current,true),
    {consumed:148.75,returned:10,wasted:1,deposited:159.75});
});
test('incomplete output does not invent consumption or zero out manually entered amounts', () => {
  const row={required:300,unit:'KG'}, current={consumed:150,returned:0,wasted:0};
  assert.equal(calculateMaterialActuals(row,'',6000,current).consumed,null);
  assert.equal(calculateMaterialActuals(row,3000,0,current).consumed,null);
  assert.equal(calculateMaterialActuals(row,'',6000,current,true).consumed,150);
  assert.equal(calculateMaterialActuals(row,3000,6000,{returned:'',wasted:0}).deposited,null);
});
test('decimal sums use six decimal places and higher output remains editable', () => {
  assert.equal(calculateMaterialActuals({required:1,unit:'KG'},1,3,{returned:.1,wasted:.2}).deposited,.633333);
  const result=calculateMaterialActuals({required:100,unit:'KG'},1200,1000,{returned:5,wasted:0});
  assert.equal(result.consumed,120);
  assert.equal(calculateMaterialActuals({required:100,unit:'KG'},1200,1000,{...result,consumed:105},true).deposited,110);
});
