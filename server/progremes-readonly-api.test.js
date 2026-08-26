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

test("internal API forwards Suppliers as an allow-listed resource without exposing the MES secret", async () => {
  const res = responseCapture();
  const serverSecret = "never-return-this-secret";
  let requestedResource;
  let requestedQuery;
  await handleProgremesReadonlyRequest(
    { method: "GET", query: { resource: "suppliers", page: "1", active: "true" }, headers: { authorization: "Bearer workspace-session" } },
    res,
    {
      authorize: async () => ({ id: "workspace-user" }),
      clientFactory: () => ({
        request: async (resource, query) => {
          requestedResource = resource;
          requestedQuery = query;
          return { page: 1, pageSize: 100, total: 0, items: [] };
        },
      }),
    },
  );

  assert.equal(res.statusCode, 200);
  assert.equal(requestedResource, "suppliers");
  assert.deepEqual(requestedQuery, { resource: "suppliers", page: "1", active: "true" });
  assert.equal(JSON.stringify(res.payload).includes(serverSecret), false);
});

test("internal API rejects arbitrary resources before creating the MES client", async () => {
  for (const resource of ["https://evil.example/path"]) {
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

test("diagnostics health espone i gate Workspace e fallisce chiuso quando Production è OFF", async () => {
  const res = responseCapture();
  await handleProgremesReadonlyRequest(
    { method: "GET", query: { resource: "diagnostics-health" }, headers: { authorization: "Bearer workspace-session" } },
    res,
    {
      authorize: async () => ({ id: "workspace-user" }),
      clientFactory: () => ({ request: async () => ({
        globalStatus: "GREEN", blocking: 0, receiveRdp: true, receiveDecisions: true,
        executeProduction: true, createLots: true,
      }) }), env: {},
    },
  );
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.globalStatus, "RED");
  assert.equal(res.payload.blocking, 1);
  assert.equal(res.payload.productionGates.allOn, false);
});
