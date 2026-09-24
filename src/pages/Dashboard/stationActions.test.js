import test from 'node:test';
import assert from 'node:assert/strict';
import {stationActionUrl} from './productionCalendar.js';
import {progremesContextualRoute} from '../../../server/progremes-sso-routes.js';
import {requestProgremesNavigation,progremesWorkspaceDestination,isProgremesFrameMessage} from '../ProgreMes/progremesWindow.js';

test('card actions keep station and order through authenticated SSO without executing writes',async()=>{
 for(const station of ['ST01','ST5','ST7','ST11']) for(const operation of ['start','close']) {
  const path=stationActionUrl({operationType:'Production',resourceCode:station,productionOrderId:42},operation);
  assert.ok(path.startsWith('/produzione/progremes.PlanningProduction?'));
  await requestProgremesNavigation('test-token',{screenCode:'progremes.PlanningProduction',search:path.split('?')[1],fetcher:async(_,options)=>{
   const body=JSON.parse(options.body);
   assert.equal(body.action,'progremes_sso');
   assert.equal(progremesContextualRoute(body.screenCode,body.context),`/stations/${station}?stationAction=${operation}&orderId=42`);
   return {ok:true,json:async()=>({url:'https://mes.example/Account/WorkspaceSso?ticket=test'})};
  }});
 }
});
test('invalid card targets and actions never produce operational links',()=>{
 const activity={operationType:'Production',resourceCode:'ST7',productionOrderId:42};
 for(const productionOrderId of [0,-1,'bad',2147483648]) assert.equal(stationActionUrl({...activity,productionOrderId},'start'),'');
 assert.equal(stationActionUrl(activity,'machine-start'),'');
 assert.equal(stationActionUrl({...activity,operationType:'Packaging'},'close'),'');
 for(const context of [{stationAction:'start'}, {stationAction:'machine-start',orderId:42},{stationAction:'close',orderId:-1}])
  assert.throws(()=>progremesContextualRoute('progremes.PlanningProduction',{destination:'station',station:'ST7',...context}));
});
test('MES station navigation stays in Workspace and requires the trusted frame',()=>{
 const path='/produzione/progremes.PlanningProduction?destination=station&station=ST7&workspaceMesWindow=1';
 const data={type:'progremes-workspace-navigate',path};
 assert.equal(progremesWorkspaceDestination(data),path);
 const source={};const origin='https://mes.example';
 assert.equal(isProgremesFrameMessage({data,source,origin},source,origin),true);
 assert.equal(isProgremesFrameMessage({data,source:{},origin},source,origin),false);
 assert.equal(progremesWorkspaceDestination({...data,path:'//evil.example'+path}),null);
 assert.equal(progremesWorkspaceDestination({...data,path:path.replace('ST7','../admin')}),null);
});
