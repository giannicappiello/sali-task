import assert from "node:assert/strict";
import test from "node:test";
import {
  INFRASTRUCTURE_PROBES,
  checkAndRecordInfrastructureHealth,
  runInfrastructureProbe,
} from "./infrastructure-health.js";

test("il gateway documenti richiede anche il payload health corretto", async () => {
  const result = await runInfrastructureProbe(INFRASTRUCTURE_PROBES[0], {
    fetchImpl: async () => new Response(JSON.stringify({ ok: true, service: "progre-document-gateway" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  });
  assert.equal(result.ok, true);
  assert.equal(result.statusCode, 200);
});

test("una risposta 401 dell'API ProgreMES conferma la raggiungibilità", async () => {
  const result = await runInfrastructureProbe(INFRASTRUCTURE_PROBES[1], {
    fetchImpl: async () => new Response("Non autorizzato", { status: 401 }),
  });
  assert.equal(result.ok, true);
  assert.equal(result.statusCode, 401);
});

test("timeout e errori di rete vengono registrati come guasto", async () => {
  const result = await runInfrastructureProbe(INFRASTRUCTURE_PROBES[1], {
    fetchImpl: async () => { throw new Error("host irraggiungibile"); },
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /host irraggiungibile/);
});

test("il controllo Aruba registra ogni sonda tramite la RPC protetta", async () => {
  const calls = [];
  const admin = {
    async rpc(name, parameters) {
      calls.push({ name, parameters });
      return { data: { state: "attivo" }, error: null };
    },
  };
  const result = await checkAndRecordInfrastructureHealth(admin, {
    probes: [INFRASTRUCTURE_PROBES[0]],
    fetchImpl: async () => new Response(JSON.stringify({ ok: true, service: "progre-document-gateway" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, "registra_controllo_infrastruttura");
  assert.equal(calls[0].parameters.p_ok, true);
  assert.equal(result.transitions[0].state, "attivo");
});
