import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { workbenchOrderBelongsToCustomer } from "./workspacemes-workbench.js";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
test("multiple customer workbench scope accepts every selected customer and rejects others", () => {
  assert.equal(workbenchOrderBelongsToCustomer({ codice_cliente: "B" }, ["A", "B"]), true);
  assert.equal(workbenchOrderBelongsToCustomer({ mexal_cod_conto: " a " }, ["A", "B"]), true);
  assert.equal(workbenchOrderBelongsToCustomer({ codice_cliente: "C" }, ["A", "B"]), false);
  assert.equal(workbenchOrderBelongsToCustomer({ codice_cliente: "A" }, []), false);
  assert.equal(workbenchOrderBelongsToCustomer({ codice_cliente: "A" }, null), true);
});
test("customer editor preserves multiple memberships and shows names as primary labels", async () => {
  const editor = await read("src/pages/Settings/AccessUsers.jsx");
  const picker = await read("src/pages/Settings/UserCustomerPicker.jsx");
  const edge = await read("supabase/functions/admin-manage-user/Index.ts");
  assert.match(editor, /customerLinks\.filter/);
  assert.match(editor, /customer_codes: form.customer_codes/);
  assert.match(editor, /offset \+= 500/);
  assert.match(picker, /<strong>\{customer.ragione_sociale/);
  assert.match(picker, /value.filter\(\(item\) => item !== code\)/);
  assert.match(edge, /workspace_replace_user_customers/);
  assert.doesNotMatch(edge, /onConflict: "user_id"/);
  assert.match(edge, /Object.hasOwn\(body, "customer_codes"\)/);
});
test("PRIVATE extension is role/department based and does not change commercial or write scope", async () => {
  const sql = await read("supabase/migrations/20260913020000_private_director_and_multiple_customers.sql");
  const access = await read("src/modules/orders/pages/useOrdersAccess.js");
  assert.match(sql, /lower\(btrim\(r.nome\)\)='direzione' and lower\(btrim\(d.nome\)\)='produzione'/);
  assert.match(sql, /c.area_crm='conto_terzi'/);
  assert.doesNotMatch(sql, /Maria|Ripa|36ad3b6b|update public.workspace_commercial_read_rules/i);
  assert.match(sql, /primary key \(user_id, customer_code\)/);
  assert.match(sql, /for update;/);
  assert.match(sql, /delete from public.workspace_customer_user_links[\s\S]*not\(l.customer_code=any\(resolved_codes\)\)/);
  assert.match(access, /privateCommercialRead === true && moduleCode === "private" && !customerCode/);
  assert.doesNotMatch(access.match(/canWriteAll:[^\n]+/)[0], /privateReadOnly/);
});
test("all order read screens use the complete selected customer set", async () => {
  for (const page of ["Customers", "Orders", "OrdersDashboard", "Invoices"]) {
    const code = await read(`src/modules/orders/pages/${page}.jsx`);
    assert.match(code, /\.in\("codice_cliente", readCustomerCodes\)/);
    assert.doesNotMatch(code, /\.eq\("codice_cliente", customerCode\)/);
  }
});
test("service-role order mutations validate the complete linked set", async () => {
  for (const path of ["api/mexal/submit-order.js", "api/mexal/orders/update.js", "api/mexal/orders/enqueue-confirmation-emails.js"]) {
    const code = await read(path);
    assert.match(code, /authorization.customerCodes \|\| \[authorization.customerCode\]/);
    assert.match(code, /private/);
  }
});
