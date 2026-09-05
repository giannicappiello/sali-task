import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("tutte le ricerche rapide della sezione Attività includono il cliente", () => {
  const dashboard = read("src/pages/Dashboard/Dashboard.jsx");
  const reminders = read("src/pages/Agenda/Agenda.jsx");
  const projects = read("src/pages/Projects/Projects.jsx");
  const tasks = read("src/pages/Tasks/Tasks.jsx");
  const archive = read("src/pages/Activities/ActivityArchive.jsx");

  assert.match(dashboard, /workspaceCustomerName\(customerDirectory/);
  assert.match(dashboard, /customerName,/);
  assert.match(reminders, /workspaceCustomerName\(customerDirectory/);
  assert.match(projects, /const customerName = workspaceCustomerName/);
  assert.match(tasks, /phase\.crm_customer_name/);
  assert.match(archive, /row\.customer/);
  for (const source of [dashboard, reminders, projects, tasks]) assert.match(source, /placeholder="[^"]*cliente/i);
});
