import assert from "node:assert/strict";
import test from "node:test";

import { handleProgremesReadonlyRequest } from "./progremes-readonly-api.js";

function responseCapture() {
  return {
    statusCode: 200,
    payload: null,
    headers: {},
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; },
    setHeader(name, value) { this.headers[name] = value; },
  };
}

test("internal API preserves Workspace authentication and fails closed", async () => {
  const res = responseCapture();
  let clientCalled = false;
  await handleProgremesReadonlyRequest(
    { method: "GET", query: { resource: "status" }, headers: {} },
    res,
    {
      authorize: async () => { throw Object.assign(new Error("Sessione Workspace mancante."), { status: 401 }); },
      clientFactory: () => ({ request: async () => { clientCalled = true; } }),
    },
  );

  assert.equal(res.statusCode, 401);
  assert.equal(res.payload.code, "UNAUTHORIZED");
  assert.equal(clientCalled, false);
  assert.equal(res.headers["Cache-Control"], "private, no-store");
});

test("internal API accepts GET only and never invokes authorization for other methods", async () => {
  const res = responseCapture();
  let authorized = false;
  await handleProgremesReadonlyRequest(
    { method: "POST", query: { resource: "clients" }, headers: {} },
    res,
    { authorize: async () => { authorized = true; } },
  );
  assert.equal(res.statusCode, 405);
  assert.equal(res.headers.Allow, "GET");
  assert.equal(authorized, false);
});

test("internal API forwards only an allow-listed resource and does not expose the MES secret", async () => {
  const res = responseCapture();
  const serverSecret = "never-return-this-secret";
  let requestedResource;
  await handleProgremesReadonlyRequest(
    { method: "GET", query: { resource: "clients", page: "1" }, headers: { authorization: "Bearer workspace-session" } },
    res,
    {
      authorize: async () => ({ id: "workspace-user" }),
      clientFactory: () => ({
        request: async (resource) => {
          requestedResource = resource;
          return { page: 1, pageSize: 100, total: 0, items: [] };
        },
      }),
    },
  );

  assert.equal(res.statusCode, 200);
  assert.equal(requestedResource, "clients");
  assert.equal(JSON.stringify(res.payload).includes(serverSecret), false);
});

test("internal API rejects Suppliers and arbitrary resources before creating the MES client", async () => {
  for (const resource of ["suppliers", "https://evil.example/path"]) {
    const res = responseCapture();
    let clientCreated = false;
    await handleProgremesReadonlyRequest(
      { method: "GET", query: { resource }, headers: { authorization: "Bearer workspace-session" } },
      res,
      {
        authorize: async () => ({ id: "workspace-user" }),
        clientFactory: () => {
          clientCreated = true;
          return { request: async () => null };
        },
      },
    );
    assert.equal(res.statusCode, 404);
    assert.equal(res.payload.code, "RESOURCE_NOT_ALLOWED");
    assert.equal(clientCreated, false);
  }
});
