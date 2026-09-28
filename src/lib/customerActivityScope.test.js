import test from "node:test";
import assert from "node:assert/strict";
import { matchesCustomerActivityScope } from "./customerActivityScope.js";

test("includes activities for each associated customer, including normalized codes", () => {
  const scope = { customerCode: "501.01458", customerCodes: ["501.01458", "501.02281"] };
  assert.equal(matchesCustomerActivityScope(scope, "mexal:501.01458"), true);
  assert.equal(matchesCustomerActivityScope(scope, "mexal:501.02281"), true);
  assert.equal(matchesCustomerActivityScope({ customerCode: " ab01 " }, "mexal:AB01"), true);
});

test("does not include other customers, unlinked activities or generic CRM accounts", () => {
  const scope = { customerCode: "501.01458", customerCodes: ["501.02281"] };
  for (const key of ["mexal:501.01458", "mexal:501.99999", "crm:501.02281", "", null, "mexal:"]) {
    assert.equal(matchesCustomerActivityScope(scope, key), false);
  }
  assert.equal(matchesCustomerActivityScope({}, "mexal:501.02281"), false);
  assert.equal(matchesCustomerActivityScope(null, "mexal:501.02281"), false);
});
