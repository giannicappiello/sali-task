import assert from "node:assert/strict";
import test from "node:test";
import { buildCrmCustomerDirectory, workspaceCustomerName } from "../src/modules/crm/crmWorkspaceCustomers.js";

test("le task mostrano solo il nome del cliente senza chiavi CRM tecniche", () => {
  const directKey = "crm:00000000-0000-4000-8000-000000000001";
  const directory = buildCrmCustomerDirectory([
    { id: "00000000-0000-4000-8000-000000000001", nome: "DIRECT" },
    { id: "customer-id", nome: "Farmacia Prova" },
  ]);

  assert.equal(workspaceCustomerName(directory, directKey), "DIRECT");
  assert.equal(workspaceCustomerName(directory, "crm:customer-id"), "Farmacia Prova");
  assert.equal(workspaceCustomerName(new Map(), "crm:unavailable-id"), "Cliente");
});
