import test from "node:test";
import assert from "node:assert/strict";
import { triggerArubaOrderEmailWorker } from "./orders/order-email-dispatch.js";

test("il dispatcher Aruba non parte senza configurazione", async () => {
  const previousUrl = process.env.ARUBA_EMAIL_WORKER_URL;
  const previousSecret = process.env.ARUBA_EMAIL_WORKER_SECRET;
  delete process.env.ARUBA_EMAIL_WORKER_URL;
  delete process.env.ARUBA_EMAIL_WORKER_SECRET;
  try {
    assert.deepEqual(await triggerArubaOrderEmailWorker(), { status: "not_configured" });
  } finally {
    if (previousUrl === undefined) delete process.env.ARUBA_EMAIL_WORKER_URL;
    else process.env.ARUBA_EMAIL_WORKER_URL = previousUrl;
    if (previousSecret === undefined) delete process.env.ARUBA_EMAIL_WORKER_SECRET;
    else process.env.ARUBA_EMAIL_WORKER_SECRET = previousSecret;
  }
});

test("il dispatcher usa intestazione dedicata e conta gli invii", async () => {
  const previousUrl = process.env.ARUBA_EMAIL_WORKER_URL;
  const previousSecret = process.env.ARUBA_EMAIL_WORKER_SECRET;
  process.env.ARUBA_EMAIL_WORKER_URL = "https://aps.progre.it/order-email-worker/worker.php";
  process.env.ARUBA_EMAIL_WORKER_SECRET = "test-secret";
  let request;
  try {
    const result = await triggerArubaOrderEmailWorker({
      fetchImpl: async (url, options) => {
        request = { url, options };
        return new Response(JSON.stringify({
          status: "ok",
          results: [{ status: "sent" }, { status: "idle" }],
        }), { status: 200, headers: { "content-type": "application/json" } });
      },
    });
    assert.equal(request.url, process.env.ARUBA_EMAIL_WORKER_URL);
    assert.equal(request.options.headers["X-Progre-Worker-Secret"], "test-secret");
    assert.deepEqual(result, { status: "ok", processed: 1 });
  } finally {
    if (previousUrl === undefined) delete process.env.ARUBA_EMAIL_WORKER_URL;
    else process.env.ARUBA_EMAIL_WORKER_URL = previousUrl;
    if (previousSecret === undefined) delete process.env.ARUBA_EMAIL_WORKER_SECRET;
    else process.env.ARUBA_EMAIL_WORKER_SECRET = previousSecret;
  }
});
