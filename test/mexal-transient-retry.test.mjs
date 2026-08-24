import assert from "node:assert/strict";
import test from "node:test";
import {
  MEXAL_TRANSIENT_MAX_RETRIES,
  isTransientMexalError,
  withTransientMexalRetry,
} from "../server/mexal/lib/transientRetry.js";
import { buildMexalClient } from "../server/mexal/sync-products.js";
import { mexalAuthenticatedRequest } from "../src/modules/integrations/services/mexalAuthenticatedRequest.js";

function timeout(message = "upstream request timeout") {
  return Object.assign(new Error(message), { status: 504 });
}

function mexalEnvironment() {
  return {
    MEXAL_BASE_URL: "https://mexal.example.test",
    MEXAL_USERNAME: "test-user",
    MEXAL_PASSWORD: "test-password",
    MEXAL_AZIENDA: "1",
    MEXAL_ANNO: "2026",
    MEXAL_MAGAZZINO: "5",
  };
}

async function withMexalEnvironment(operation) {
  const previous = Object.fromEntries(Object.keys(mexalEnvironment()).map((key) => [key, process.env[key]]));
  Object.assign(process.env, mexalEnvironment());
  try {
    return await operation();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("un timeout Mexal viene ritentato e poi completa la stessa lettura", async () => {
  let attempts = 0;
  const delays = [];
  const value = await withTransientMexalRetry(async () => {
    attempts += 1;
    if (attempts === 1) throw timeout();
    return "ok";
  }, { sleep: async (delay) => delays.push(delay) });

  assert.equal(value, "ok");
  assert.equal(attempts, 2);
  assert.deepEqual(delays, [500]);
});

test("timeout multipli entro il limite usano backoff progressivo e poi riescono", async () => {
  let attempts = 0;
  const delays = [];
  await withTransientMexalRetry(async () => {
    attempts += 1;
    if (attempts <= MEXAL_TRANSIENT_MAX_RETRIES) throw timeout();
  }, { sleep: async (delay) => delays.push(delay) });

  assert.equal(attempts, 4, "tre retry seguono il tentativo iniziale");
  assert.deepEqual(delays, [500, 1000, 2000]);
});

test("timeout oltre il limite conserva un errore recuperabile", async () => {
  let attempts = 0;
  let logicalUpdates = 0;
  let checkpoint = 5016;

  await assert.rejects(
    withTransientMexalRetry(async () => {
      attempts += 1;
      throw timeout();
    }, { sleep: async () => {} }),
    (error) => {
      assert.equal(error.retryable, true);
      assert.equal(error.retriesExhausted, true);
      assert.equal(error.retryAttempts, 4);
      return true;
    },
  );

  assert.equal(attempts, 4);
  assert.equal(checkpoint, 5016, "il checkpoint non avanza se la lettura non termina");
  assert.equal(logicalUpdates, 0, "nessun update avviene prima del successo Mexal");
});

test("il retry non duplica l'aggiornamento logico", async () => {
  let attempts = 0;
  let logicalUpdates = 0;
  const article = await withTransientMexalRetry(async () => {
    attempts += 1;
    if (attempts < 3) throw timeout();
    return { codice: "PB0004" };
  }, { sleep: async () => {} });

  if (article) logicalUpdates += 1;
  assert.equal(attempts, 3);
  assert.equal(logicalUpdates, 1);
});

test("una risposta HTTP Mexal 504 viene classificata e ritentata", async () => {
  await withMexalEnvironment(async () => {
    let requests = 0;
    const client = buildMexalClient({
      retryOptions: { sleep: async () => {} },
      request: async () => {
        requests += 1;
        if (requests === 1) {
          return { status: 504, body: JSON.stringify({ error: { "response-detail": "upstream request timeout" } }) };
        }
        return { status: 200, body: JSON.stringify({ dati: [{ codice: "PB0004" }] }) };
      },
    });

    const payload = await client.getJson("/articoli");
    assert.equal(requests, 2);
    assert.equal(payload.dati[0].codice, "PB0004");
  });
});

test("un errore permanente non viene ritentato", async () => {
  let attempts = 0;
  await assert.rejects(withTransientMexalRetry(async () => {
    attempts += 1;
    throw Object.assign(new Error("richiesta non valida"), { status: 400 });
  }, { sleep: async () => {} }), /richiesta non valida/);
  assert.equal(attempts, 1);
  assert.equal(isTransientMexalError(Object.assign(new Error("non trovato"), { status: 404 })), false);
});

test("un 401 aggiorna la sessione una sola volta e ripete la stessa richiesta", async () => {
  const refreshes = [];
  const requests = [];
  const response = await mexalAuthenticatedRequest("/api/mexal/automation", { syncRunId: 435, resume: true }, {
    getToken: async ({ refresh }) => {
      refreshes.push(refresh);
      return refresh ? "token-nuovo" : "token-scaduto";
    },
    fetchImpl: async (path, options) => {
      requests.push({ path, options });
      return { status: requests.length === 1 ? 401 : 200 };
    },
  });

  assert.equal(response.status, 200);
  assert.deepEqual(refreshes, [false, true]);
  assert.equal(requests.length, 2);
  assert.equal(requests[0].options.headers.Authorization, "Bearer token-scaduto");
  assert.equal(requests[1].options.headers.Authorization, "Bearer token-nuovo");
  assert.equal(requests[0].options.body, requests[1].options.body, "il refresh non cambia run o payload");
});
