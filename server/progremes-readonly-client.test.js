import assert from "node:assert/strict";
import test from "node:test";

import {
  buildProgremesUrl,
  createProgremesClient,
  ProgremesClientError,
  PROGREMES_ALLOWED_RESOURCES,
  validateProgremesQuery,
} from "./progremes-readonly-client.js";

const silentLogger = { error() {} };
const baseUrl = "https://mes.example.test/api/workspace/v1/";
const secret = "test-only-workspace-secret";

function pagedClientPayload(extra = {}) {
  return {
    page: 2,
    pageSize: 25,
    total: 1,
    items: [{ id: 7, codiceMexal: "C007", ragioneSociale: "Cliente Test", attivo: true, ...extra }],
  };
}

function pagedSupplierPayload(extra = {}) {
  return {
    page: 1,
    pageSize: 50,
    total: 1,
    items: [{
      id: 11,
      codiceMexal: "F011",
      ragioneSociale: "Fornitore Test",
      partitaIva: "IT00000000000",
      codiceFiscale: "00000000000",
      indirizzo: "Via Test 1",
      cap: "00100",
      localita: "Roma",
      provincia: "RM",
      telefono: "+3900000000",
      email: "fornitore@example.test",
      pec: "fornitore@pec.example.test",
      attivo: true,
      ...extra,
    }],
  };
}

test("builds only allow-listed ProgreMES URLs and validated query strings", () => {
  const url = buildProgremesUrl("clients", {
    page: "2",
    pageSize: "25",
    search: "Cliente & Figli",
    active: "true",
  }, baseUrl);

  assert.equal(url.origin, "https://mes.example.test");
  assert.equal(url.pathname, "/api/workspace/v1/clients");
  assert.equal(url.searchParams.get("page"), "2");
  assert.equal(url.searchParams.get("pageSize"), "25");
  assert.equal(url.searchParams.get("search"), "Cliente & Figli");
  assert.equal(url.searchParams.get("active"), "true");
  assert.equal(PROGREMES_ALLOWED_RESOURCES.includes("suppliers"), true);
});

test("adds X-Workspace-Secret server-side and returns a sanitized paged response", async () => {
  let capturedHeaders;
  const client = createProgremesClient({
    baseUrl,
    secret,
    logger: silentLogger,
    fetchFn: async (_url, init) => {
      capturedHeaders = init.headers;
      return new Response(JSON.stringify(pagedClientPayload({ internalOnly: "remove-me" })), { status: 200 });
    },
  });

  const result = await client.request("clients", { page: "2", pageSize: "25" });
  assert.equal(capturedHeaders["X-Workspace-Secret"], secret);
  assert.deepEqual(result, pagedClientPayload());
  assert.equal(JSON.stringify(result).includes(secret), false);
  assert.equal(JSON.stringify(result).includes("internalOnly"), false);
});

test("calls /suppliers with MES filters and projects only the public supplier DTO", async () => {
  let capturedUrl;
  const client = createProgremesClient({
    baseUrl,
    secret,
    logger: silentLogger,
    fetchFn: async (url) => {
      capturedUrl = String(url);
      return new Response(JSON.stringify(pagedSupplierPayload({ internalOnly: "remove-me" })), { status: 200 });
    },
  });

  const result = await client.request("suppliers", { page: "1", pageSize: "50", search: "Fornitore", active: "true", updatedAfter: "2026-08-01T00:00:00Z" });
  const url = new URL(capturedUrl);
  assert.equal(url.pathname, "/api/workspace/v1/suppliers");
  assert.equal(url.searchParams.get("search"), "Fornitore");
  assert.equal(url.searchParams.get("active"), "true");
  assert.equal(url.searchParams.get("updatedAfter"), "2026-08-01T00:00:00Z");
  assert.deepEqual(result, pagedSupplierPayload());
  assert.equal(JSON.stringify(result).includes("internalOnly"), false);
});

test("reuses the existing ProgreMES URL and integration secret", async () => {
  const environment = globalThis.process.env;
  const previous = {
    PROGREMES_URL: environment.PROGREMES_URL,
    PROGREMES_INTEGRATION_SECRET: environment.PROGREMES_INTEGRATION_SECRET,
  };
  environment.PROGREMES_URL = "https://mes.shared.example/";
  environment.PROGREMES_INTEGRATION_SECRET = "existing-integration-secret";

  try {
    let capturedUrl;
    let capturedHeaders;
    const client = createProgremesClient({
      logger: silentLogger,
      fetchFn: async (url, init) => {
        capturedUrl = String(url);
        capturedHeaders = init.headers;
        return new Response(JSON.stringify(pagedClientPayload()), { status: 200 });
      },
    });

    await client.request("clients", { page: "2", pageSize: "25" });
    assert.equal(capturedUrl, "https://mes.shared.example/api/workspace/v1/clients?page=2&pageSize=25");
    assert.equal(capturedHeaders["X-Workspace-Secret"], "existing-integration-secret");
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete environment[name];
      else environment[name] = value;
    }
  }
});

test("validates status metadata including enabled Suppliers", async (t) => {
  const validStatus = {
    source: "ProgreMES",
    apiVersion: 1,
    readOnly: true,
    generatedAt: "2026-08-22T10:00:00.000Z",
    modules: {
      clients: true,
      suppliers: true,
      articles: true,
      orders: true,
      productionSummary: true,
      inventory: true,
      planning: true,
    },
    internalOnly: "remove-me",
  };

  await t.test("accepts and projects a safe status response", async () => {
    const client = createProgremesClient({
      baseUrl,
      secret,
      logger: silentLogger,
      fetchFn: async () => new Response(JSON.stringify(validStatus), { status: 200 }),
    });
    const result = await client.request("status");
    assert.equal(result.modules.suppliers, true);
    assert.equal("internalOnly" in result, false);
  });

  await t.test("rejects a status response with a non-boolean Suppliers flag", async () => {
    const client = createProgremesClient({
      baseUrl,
      secret,
      logger: silentLogger,
      fetchFn: async () => new Response(JSON.stringify({ ...validStatus, modules: { ...validStatus.modules, suppliers: "true" } }), { status: 200 }),
    });
    await assert.rejects(client.request("status"), (error) => error.code === "INVALID_RESPONSE");
  });
});

test("fails closed when the server-side secret is missing", () => {
  assert.throws(
    () => createProgremesClient({ baseUrl, secret: "", logger: silentLogger }),
    (error) => error instanceof ProgremesClientError && error.code === "MISSING_CONFIGURATION",
  );
});

test("classifies upstream 401, 403, 404 and 5xx without including response bodies", async (t) => {
  for (const status of [401, 403, 404, 500]) {
    await t.test(`HTTP ${status}`, async () => {
      const client = createProgremesClient({
        baseUrl,
        secret,
        logger: silentLogger,
        fetchFn: async () => new Response(`sensitive upstream body ${secret}`, { status }),
      });
      await assert.rejects(
        client.request("clients"),
        (error) => error instanceof ProgremesClientError
          && error.code === "UPSTREAM_HTTP_ERROR"
          && error.upstreamStatus === status
          && !error.message.includes(secret),
      );
    });
  }
});

test("reports invalid JSON and unreachable ProgreMES safely", async (t) => {
  await t.test("invalid JSON", async () => {
    const client = createProgremesClient({
      baseUrl,
      secret,
      logger: silentLogger,
      fetchFn: async () => new Response("not-json", { status: 200 }),
    });
    await assert.rejects(client.request("clients"), (error) => error.code === "INVALID_RESPONSE");
  });

  await t.test("unreachable", async () => {
    const client = createProgremesClient({
      baseUrl,
      secret,
      logger: silentLogger,
      fetchFn: async () => { throw new TypeError("network details"); },
    });
    await assert.rejects(client.request("clients"), (error) => error.code === "UNREACHABLE");
  });
});

test("aborts requests that exceed the configured timeout", async () => {
  const client = createProgremesClient({
    baseUrl,
    secret,
    timeoutMs: 1_000,
    logger: silentLogger,
    fetchFn: async (_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })), { once: true });
    }),
  });

  await assert.rejects(client.request("clients"), (error) => error.code === "TIMEOUT" && error.status === 504);
});

test("rejects arbitrary resources, unknown filters and unsafe pagination", () => {
  assert.throws(() => buildProgremesUrl("https://evil.example", {}, baseUrl), (error) => error.code === "RESOURCE_NOT_ALLOWED");
  assert.throws(() => validateProgremesQuery("clients", { url: "https://evil.example" }), (error) => error.code === "INVALID_QUERY");
  assert.throws(() => validateProgremesQuery("clients", { pageSize: "501" }), (error) => error.code === "INVALID_QUERY");
  assert.throws(() => validateProgremesQuery("planning", { from: "2026-08-22", to: "2026-08-21" }), (error) => error.code === "INVALID_QUERY");
});

test("requires HTTPS except for explicit local loopback development", () => {
  assert.throws(() => buildProgremesUrl("status", {}, "http://mes.internal/api/workspace/v1"), (error) => error.code === "INVALID_CONFIGURATION");
  assert.equal(
    buildProgremesUrl("status", {}, "http://127.0.0.1:5150/api/workspace/v1").toString(),
    "http://127.0.0.1:5150/api/workspace/v1/status",
  );
});
