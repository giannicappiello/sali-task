import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import {
  ORDER_EMAIL_IDLE_WAIT_MS,
  createOrderEmailWorkerId,
  runOrderEmailWorker,
} from "../workers/order-email/index.mjs";

const environment = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-test",
};

function dependencies(overrides = {}) {
  const signals = new EventEmitter();
  const logs = [];
  const supabase = { rpc() {} };
  const smtp = { send() {} };
  const supabaseCalls = [];
  let smtpCreations = 0;

  return {
    signals,
    logs,
    supabase,
    smtp,
    supabaseCalls,
    get smtpCreations() { return smtpCreations; },
    options: {
      environment,
      signalSource: signals,
      logger: {
        log(value) { logs.push(value); },
        error(value) { logs.push(value); },
      },
      createSupabaseClient(url, key, options) {
        supabaseCalls.push({ url, key, options });
        return supabase;
      },
      createSmtp() {
        smtpCreations += 1;
        return smtp;
      },
      workerId: "order-email-windows:test",
      ...overrides,
    },
  };
}

{
  const context = dependencies({
    args: ["--once"],
    async processJob(input) {
      assert.equal(input.workerId, "order-email-windows:test");
      assert.equal(input.supabase, context.supabase);
      assert.equal(input.smtp, context.smtp);
      return { status: "sent", emailId: 42 };
    },
  });
  const result = await runOrderEmailWorker(context.options);

  assert.deepEqual(result, { status: "sent", emailId: 42 });
  assert.deepEqual(context.supabaseCalls, [{
    url: environment.SUPABASE_URL,
    key: environment.SUPABASE_SERVICE_ROLE_KEY,
    options: { auth: { persistSession: false, autoRefreshToken: false } },
  }]);
  assert.equal(context.smtpCreations, 1);
  assert.equal(context.logs.some((entry) => entry.includes('"status":"sent"')), true);
  assert.equal(context.signals.listenerCount("SIGINT"), 0);
  assert.equal(context.signals.listenerCount("SIGTERM"), 0);
}

{
  let executions = 0;
  let waits = 0;
  const context = dependencies({
    args: [],
    async processJob() {
      executions += 1;
      if (executions === 1) return { status: "idle" };
      context.signals.emit("SIGTERM");
      return { status: "sent", emailId: 43 };
    },
    async wait(milliseconds) {
      waits += 1;
      assert.equal(milliseconds, ORDER_EMAIL_IDLE_WAIT_MS);
    },
  });
  const result = await runOrderEmailWorker(context.options);

  assert.deepEqual(result, { status: "sent", emailId: 43 });
  assert.equal(executions, 2);
  assert.equal(waits, 1);
  assert.equal(context.logs.some((entry) => entry.includes('"signal":"SIGTERM"')), true);
}

{
  const context = dependencies({
    args: ["--once"],
    environment: { SUPABASE_URL: environment.SUPABASE_URL },
    async processJob() {
      assert.fail("Il job non deve partire senza service-role key.");
    },
  });
  await assert.rejects(
    runOrderEmailWorker(context.options),
    /Variabile ambiente mancante: SUPABASE_SERVICE_ROLE_KEY/,
  );
}

{
  const first = createOrderEmailWorkerId();
  const second = createOrderEmailWorkerId();
  assert.match(first, /^order-email-windows:/);
  assert.notEqual(first, second);
}

console.log("order email local worker: once, loop, shutdown and environment verified");
