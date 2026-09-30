import test from 'node:test';
import assert from 'node:assert/strict';
import { progremesContextualRoute } from './progremes-sso-routes.js';
test('mixing overview uses the planning permission and a fixed MES route', () => {
  assert.equal(progremesContextualRoute('progremes.PlanningProduction',{destination:'station-overview',returnUrl:'https://invalid.example'}),'/stations');
  assert.equal(progremesContextualRoute('other',{destination:'station-overview'},'/original'),'/original');
});
test('individual Station routing still requires a valid station', () => {
  assert.equal(progremesContextualRoute('progremes.PlanningProduction',{destination:'station',station:'ST7'}),'/stations/ST7');
  assert.throws(()=>progremesContextualRoute('progremes.PlanningProduction',{destination:'station'}));
});
