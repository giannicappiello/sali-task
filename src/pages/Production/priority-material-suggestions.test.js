import test from 'node:test';
import assert from 'node:assert/strict';
import { suggestMaterialDisengagements } from './priority-material-suggestions.js';
test('uses farthest eligible dated donors and only the necessary quantity', () => {
  const materials = [{articleCode:'MP', eligible:true, minimumRelease:50, donors:[
    {orderId:2,eligible:true,plannedStart:'2026-10-01T08:00',reserved:30},
    {orderId:3,eligible:true,plannedStart:'2026-11-01T08:00',reserved:40},
    {orderId:4,eligible:false,plannedStart:'2026-12-01T08:00',reserved:100},
    {orderId:5,eligible:true,plannedStart:null,reserved:100}]}];
  assert.deepEqual(suggestMaterialDisengagements(materials,'2026-09-24T08:00'), {'MP:3':40,'MP:2':10});
  assert.deepEqual(suggestMaterialDisengagements(materials,'2026-12-24T08:00'), {});
  assert.deepEqual(suggestMaterialDisengagements(materials,'invalid'), {});
});
