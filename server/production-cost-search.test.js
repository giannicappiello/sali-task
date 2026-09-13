import test from "node:test";
import assert from "node:assert/strict";
import { matchesProductionSearch, withCustomerNames } from "../src/features/production-costs/search.js";

test("resolves the customer name when MES contains only the code", () => {
 const source={customerCode:"501.001",customerName:"501.001",links:[]};
 const result=withCustomerNames(source,new Map([["501.001","Salì di Ischia S.r.l."]]));
 assert.equal(matchesProductionSearch(result,"sali ischia"),true);
 assert.equal(matchesProductionSearch(result,"501.001"),true);
 assert.equal(matchesProductionSearch(result,"altro cliente"),false);
 assert.equal(source.customerName,"501.001");
});
test("searches every linked OCT customer of a shared production", () => {
 const result=withCustomerNames({customerCode:"A",links:[{customerCode:"B",oct:"OC/2/139"}]},
  new Map([["A","Primo cliente"],["B","Farmacia Sant’Andrea"]]));
 assert.equal(matchesProductionSearch(result,"farmacia sant'andrea 139"),true);
 assert.equal(matchesProductionSearch(result,"B"),true);
});
test("preserves known names and existing search fields when lookup is unavailable", () => {
 const result=withCustomerNames({customerCode:"A",customerName:"Cliente storico",articleName:"Crema Q10",
  phases:[{machine:{code:"ST1"},personnel:[{name:"Mario Rossi",department:"Produzione"}]}]},new Map());
 assert.equal(matchesProductionSearch(result,"cliente Q10 rossi"),true);
 assert.equal(matchesProductionSearch(result,"ST1 produzione"),true);
 assert.equal(matchesProductionSearch(result,"   "),true);
 assert.equal(matchesProductionSearch(result,"cliente mancante"),false);
});
