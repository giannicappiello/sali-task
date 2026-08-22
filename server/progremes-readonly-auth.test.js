import assert from "node:assert/strict";
import test from "node:test";

import { requireProgremesReadonlyAccess } from "./progremes-readonly-auth.js";

function adminDouble({ profile = { id: "profile-1", attivo: true }, enabled = true } = {}) {
  return {
    auth: {
      getUser: async () => ({ data: { user: { id: "auth-1" } }, error: null }),
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: profile, error: null }),
        }),
      }),
    }),
    rpc: async (name, parameters) => {
      assert.equal(name, "workspace_module_enabled_for_user");
      assert.deepEqual(parameters, { target_user_id: "profile-1", target_module: "progremes" });
      return { data: enabled, error: null };
    },
  };
}

test("authorization rejects a missing Workspace session before creating server clients", async () => {
  await assert.rejects(
    requireProgremesReadonlyAccess({ headers: {} }),
    (error) => error.status === 401,
  );
});

test("authorization rejects inactive users and users without the ProgreMES module", async (t) => {
  await t.test("inactive profile", async () => {
    await assert.rejects(
      requireProgremesReadonlyAccess(
        { headers: { authorization: "Bearer workspace-session" } },
        { admin: adminDouble({ profile: { id: "profile-1", attivo: false } }) },
      ),
      (error) => error.status === 403,
    );
  });

  await t.test("module denied", async () => {
    await assert.rejects(
      requireProgremesReadonlyAccess(
        { headers: { authorization: "Bearer workspace-session" } },
        { admin: adminDouble({ enabled: false }) },
      ),
      (error) => error.status === 403,
    );
  });
});

test("authorization accepts only an active user with Workspace ProgreMES access", async () => {
  const identity = await requireProgremesReadonlyAccess(
    { headers: { authorization: "Bearer workspace-session" } },
    { admin: adminDouble() },
  );
  assert.deepEqual(identity, { authUserId: "auth-1", profileId: "profile-1" });
});
