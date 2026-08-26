import assert from "node:assert/strict";
import test from "node:test";

import { requireProgremesReadonlyAccess } from "./progremes-readonly-auth.js";

function adminDouble({ profile = { id: "profile-1", attivo: true }, enabled = true, diagnosticPermission = false } = {}) {
  return {
    auth: {
      getUser: async () => ({ data: { user: { id: "auth-1" } }, error: null }),
    },
    from: (table) => ({ select: () => ({ eq: () => table === "utenti"
      ? { maybeSingle: async () => ({ data: profile, error: null }) }
      : { in: () => ({ limit: async () => ({ data: diagnosticPermission ? [{ permessi: { codice: "diagnostics.view" } }] : [], error: null }) }) } }) }),
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

test("diagnostic resources require diagnostics.view unless the user is an administrator", async () => {
  const request = { headers: { authorization: "Bearer workspace-session" }, query: { resource: "diagnostics" } };
  await assert.rejects(requireProgremesReadonlyAccess(request, { admin: adminDouble() }), (error) => error.status === 403);
  const permitted = await requireProgremesReadonlyAccess(request, { admin: adminDouble({ diagnosticPermission: true }) });
  assert.equal(permitted.profileId, "profile-1");
  const administrator = await requireProgremesReadonlyAccess(request, { admin: adminDouble({ profile: { id: "profile-1", attivo: true, ruoli: { amministratore_workspace: true } } }) });
  assert.equal(administrator.profileId, "profile-1");
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
