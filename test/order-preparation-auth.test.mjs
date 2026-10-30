import test from "node:test";
import assert from "node:assert/strict";
import {
  preparationSession,
  SCREEN,
} from "../server/order-preparation-auth.js";
function adminFixture({
  level = "scrittura",
  linked = false,
  legacy = false,
  active = true,
  role = "Operatore",
  write = true,
  configure = false,
} = {}) {
  const calls = [];
  const db = {
    calls,
    auth: {
      getUser: async () => ({
        data: { user: { id: "auth-user" } },
        error: null,
      }),
    },
    from(table) {
      const q = {
        select() {
          return q;
        },
        eq() {
          return q;
        },
        limit() {
          return q;
        },
        maybeSingle() {
          return q;
        },
        then(resolve) {
          resolve({
            data:
              table === "utenti"
                ? { id: "profile", attivo: active, ruoli: { nome: role } }
                : table === "workspace_customer_user_links"
                  ? linked
                    ? [{ customer_code: "501.1" }]
                    : []
                  : legacy
                    ? [{ codice_cliente: "501.1" }]
                    : [],
            error: null,
          });
        },
      };
      return q;
    },
    async rpc(name, args) {
      calls.push([name, args]);
      return {
        data:
          name === "workspace_screen_level_for_user"
            ? level
            : args.permission_code.endsWith(".write")
              ? write
              : configure,
        error: null,
      };
    },
  };
  return db;
}
for (const [name, options, status] of [
  ["screen denied", { level: "nessuno" }, 403],
  ["inactive", { active: false }, 403],
  ["linked customer", { linked: true }, 403],
  ["legacy customer", { legacy: true }, 403],
  ["customer role", { role: "Portale Cliente" }, 403],
])
  test(`allestimento auth rejects ${name}`, async () => {
    await assert.rejects(
      preparationSession(
        { headers: { authorization: "Bearer valid" } },
        { admin: adminFixture(options) },
      ),
      (e) => e.status === status,
    );
  });
test("allestimento auth requires bearer and accepts independent read-only screen grant", async () => {
  await assert.rejects(
    preparationSession({ headers: {} }, { admin: adminFixture() }),
    (e) => e.status === 401,
  );
  const db = adminFixture({ level: "lettura", write: false });
  const result = await preparationSession(
    { headers: { authorization: "Bearer valid" } },
    { admin: db },
  );
  assert.equal(result.canWrite, false);
  assert.equal(result.canConfigure, false);
  assert(db.calls.every(([, args]) => args.target_screen === SCREEN));
});
test("allestimento permissions stay bounded to this screen", async () => {
  const result = await preparationSession(
    { headers: { authorization: "Bearer valid" } },
    { admin: adminFixture({ level: "amministrazione", configure: true }) },
  );
  assert(result.canWrite && result.canConfigure);
});
