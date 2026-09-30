import test from 'node:test';
import assert from 'node:assert/strict';
import { operationalMesRoute } from './operationalMesRoute.js';
const path='/produzione/progremes.PlanningProduction';
test('solo destinazioni operative: nessun accesso al planning o query aggiuntive', () => {
 for(const dest of ['station-overview','filling-overview']) assert.equal(operationalMesRoute(path,'?destination='+dest),true);
 assert.equal(operationalMesRoute(path,'?destination=station&station=ST7&stationAction=start&orderId=22'),true);
 for(const search of ['', '?destination=planning','?destination=station-overview&action=delete','?destination=station&station=ST7&stationAction=delete&orderId=22','?destination=station&station=ST7&stationAction=start&orderId=-1']) assert.equal(operationalMesRoute(path,search),false);
 assert.equal(operationalMesRoute('/produzione/progremes.Planning','?destination=station-overview'),false);
});
