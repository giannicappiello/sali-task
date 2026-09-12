import test from "node:test";
import assert from "node:assert/strict";
import { loadDepartmentMembers } from "../src/pages/Settings/departmentMembers.js";

function database(memberships, users, failure) {
  const calls = [];
  return { calls, from(table) {
    calls.push(table);
    const query = {
      select(fields) { calls.push(fields); return query; },
      eq(field, value) { calls.push([field, value]); return query; },
      in(field, values) { calls.push([field, values]); return query; },
      order() { return query; },
      then(resolve, reject) { return Promise.resolve({ data: table === "utenti_reparti" ? memberships : users, error: failure?.table === table ? failure.error : null }).then(resolve, reject); },
    };
    return query;
  } };
}
test("department membership uses only current canonical associations, deduplicated", async () => {
  const users = [{ id: "a", attivo: true }, { id: "b", attivo: false }];
  const db = database([{ utente_id: "a" }, { utente_id: "a" }, { utente_id: "b" }], users);
  assert.deepEqual(await loadDepartmentMembers(db, "department"), users);
  assert.ok(db.calls.some((call) => Array.isArray(call) && call[0] === "reparto_id" && call[1] === "department"));
  assert.ok(db.calls.some((call) => Array.isArray(call) && call[0] === "id" && JSON.stringify(call[1]) === '["a","b"]'));
  assert.ok(!db.calls.some((call) => typeof call === "string" && call.includes("reparto_id")));
});
test("empty and new departments do not query unrelated users", async () => {
  const db = database([], []);
  assert.deepEqual(await loadDepartmentMembers(db, "new"), []);
  assert.equal(db.calls.length, 0);
  assert.deepEqual(await loadDepartmentMembers(db, "empty"), []);
  assert.ok(!db.calls.includes("utenti"));
});
test("errors are surfaced instead of claiming no users are associated", async () => {
  for (const table of ["utenti_reparti", "utenti"]) {
    const error = new Error("Permission denied");
    const db = database([{ utente_id: "a" }], [], { table, error });
    await assert.rejects(loadDepartmentMembers(db, "department"), error);
  }
});
test("reloading replaces old membership instead of merging it", async () => {
  const first = database([{ utente_id: "a" }], [{ id: "a" }]);
  const next = database([{ utente_id: "b" }], [{ id: "b" }]);
  assert.deepEqual(await loadDepartmentMembers(first, "department"), [{ id: "a" }]);
  assert.deepEqual(await loadDepartmentMembers(next, "department"), [{ id: "b" }]);
});
