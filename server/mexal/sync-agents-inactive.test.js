import assert from "node:assert/strict";
import test from "node:test";
import { removeInactiveAgents } from "./sync-agents.js";

test("la rimozione agenti disattiva e scollega soltanto gli utenti non più presenti in Mexal", async () => {
  const calls = {
    tables: [],
    userSelections: [],
    userUpdates: [],
    deletedAgentIds: [],
    bannedAuthUsers: [],
  };
  const existingAgents = [
    { id: "agent-active", codice: "602.ACTIVE", workspace_utente_id: "user-active" },
    { id: "agent-stale", codice: "602.STALE", workspace_utente_id: "user-stale" },
  ];

  const admin = {
    from(table) {
      calls.tables.push(table);
      if (table === "mexal_agenti") {
        return {
          select() {
            return Promise.resolve({ data: existingAgents, error: null });
          },
          delete() {
            return {
              in(column, values) {
                assert.equal(column, "id");
                calls.deletedAgentIds.push(...values);
                return Promise.resolve({ error: null });
              },
            };
          },
        };
      }
      if (table === "utenti") {
        return {
          select() {
            return {
              in(column, values) {
                assert.equal(column, "id");
                calls.userSelections.push(...values);
                return Promise.resolve({
                  data: [{ id: "user-stale", auth_user_id: "auth-stale" }],
                  error: null,
                });
              },
            };
          },
          update(payload) {
            return {
              in(column, values) {
                assert.equal(column, "id");
                calls.userUpdates.push({ payload, values });
                return Promise.resolve({ error: null });
              },
            };
          },
        };
      }
      throw new Error(`Tabella inattesa nel test: ${table}`);
    },
    auth: {
      admin: {
        updateUserById(authUserId, payload) {
          calls.bannedAuthUsers.push({ authUserId, payload });
          return Promise.resolve({ error: null });
        },
      },
    },
  };

  const removed = await removeInactiveAgents(admin, new Set(["602.ACTIVE"]));

  assert.equal(removed, 1);
  assert.deepEqual(calls.userSelections, ["user-stale"]);
  assert.deepEqual(calls.userUpdates, [{
    payload: {
      attivo: false,
      mexal_agente_id: null,
      codice_agente_mexal: null,
    },
    values: ["user-stale"],
  }]);
  assert.equal(Object.hasOwn(calls.userUpdates[0].payload, "agent_id"), false);
  assert.deepEqual(calls.deletedAgentIds, ["agent-stale"]);
  assert.deepEqual(calls.bannedAuthUsers, [{ authUserId: "auth-stale", payload: { ban_duration: "876000h" } }]);
  assert.equal(calls.userUpdates.some(({ values }) => values.includes("user-active")), false);
  assert.equal(calls.deletedAgentIds.includes("agent-active"), false);
  assert.equal(calls.tables.some((table) => ["ordini_clienti_cache", "crm_accounts"].includes(table)), false);
});
