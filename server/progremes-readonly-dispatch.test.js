import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import automationHandler from "../api/mexal/automation.js";

function responseCapture() {
  return {
    statusCode: 200,
    payload: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; },
  };
}

test("a route other than progremes-readonly continues through the legacy handler", async () => {
  const response = responseCapture();
  await automationHandler(
    { method: "GET", query: { route: "existing-route" }, body: {} },
    response,
  );

  assert.equal(response.statusCode, 405);
  assert.equal(response.payload?.error, "Metodo non consentito.");
});

test("the ProgreMES rewrite is scoped and cannot intercept unrelated API routes", async () => {
  const configuration = JSON.parse(await readFile(new URL("../vercel.json", import.meta.url), "utf8"));
  const rewrite = configuration.rewrites.find((entry) => entry.source === "/api/progremes/:resource");

  assert.deepEqual(rewrite, {
    source: "/api/progremes/:resource",
    destination: "/api/mexal/automation?route=progremes-readonly&resource=:resource",
  });
  assert.equal(configuration.rewrites.some((entry) => entry.source === "/api/:resource"), false);
  assert.equal(configuration.rewrites.some((entry) => entry.source === "/api/:path*"), false);
});
