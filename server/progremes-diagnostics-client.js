// @ts-check

import { ProgremesClientError } from "./progremes-readonly-client.js";
import { randomUUID } from "node:crypto";
import { HMAC_HEADERS, signProductionMessage } from "./progremes-production-hmac.js";

const ACTIONS = new Set(["acknowledge", "resolve", "archive"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function configuration(options = {}) {
  const base = String(options.progremesUrl ?? globalThis.process.env.PROGREMES_URL ?? "").trim();
  const secret = String(options.secret ?? globalThis.process.env.PROGREMES_INTEGRATION_SECRET ?? "").trim();
  if (!base || !secret) throw new ProgremesClientError("MISSING_CONFIGURATION", "Integrazione ProgreMES non configurata.", { status: 500 });
  let url;
  try { url = new URL(base); } catch { throw new ProgremesClientError("INVALID_CONFIGURATION", "PROGREMES_URL non valido.", { status: 500 }); }
  const loopback = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback))
    throw new ProgremesClientError("INVALID_CONFIGURATION", "ProgreMES richiede HTTPS.", { status: 500 });
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/`;
  url.search = ""; url.hash = "";
  return { url, secret };
}

export function validateDiagnosticAction(input = {}) {
  const diagnosticId = String(input.diagnosticId ?? "").trim();
  const action = String(input.action ?? "").trim().toLowerCase();
  const reason = String(input.reason ?? "").trim();
  if (!UUID.test(diagnosticId)) throw new ProgremesClientError("INVALID_DIAGNOSTIC_ID", "Identificativo diagnostica non valido.", { status: 400 });
  if (!ACTIONS.has(action)) throw new ProgremesClientError("INVALID_ACTION", "Azione diagnostica non consentita.", { status: 400 });
  if (reason.length > 1000) throw new ProgremesClientError("INVALID_REASON", "La motivazione supera il limite consentito.", { status: 400 });
  if (action === "archive" && !reason) throw new ProgremesClientError("REASON_REQUIRED", "La motivazione è obbligatoria per eliminare la diagnostica dalla vista operativa.", { status: 400 });
  return { diagnosticId, action, reason };
}

export function createProgremesDiagnosticManager(options = {}) {
  const { url: baseUrl, secret } = configuration(options);
  const fetchFn = options.fetchFn ?? globalThis.fetch;
  return Object.freeze({
    async changeStatus(input) {
      const command = validateDiagnosticAction(input);
      const path = `/api/workspace/v2/diagnostics/${command.diagnosticId}/status`;
      const url = new URL(path, baseUrl);
      const body = JSON.stringify({ action: command.action, actor: String(input.actor ?? "workspace").slice(0, 200), reason: command.reason });
      const timestamp = Math.floor(Date.now() / 1000);
      const eventId = randomUUID();
      const response = await fetchFn(url, {
        method: "POST", redirect: "error",
        headers: {
          Accept: "application/json", "Content-Type": "application/json",
          [HMAC_HEADERS.timestamp]: String(timestamp), [HMAC_HEADERS.eventId]: eventId,
          [HMAC_HEADERS.signature]: signProductionMessage({ method: "POST", path, timestamp, eventId, body, secret }),
        },
        body,
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new ProgremesClientError(String(payload.code || "UPSTREAM_HTTP_ERROR"), String(payload.error || "ProgreMES ha rifiutato l'azione diagnostica."), { status: response.status >= 400 && response.status < 500 ? response.status : 502, upstreamStatus: response.status });
      if (String(payload.diagnosticId || "").toLowerCase() !== command.diagnosticId.toLowerCase() || !payload.status)
        throw new ProgremesClientError("INVALID_RESPONSE", "Risposta diagnostica ProgreMES non valida.", { status: 502 });
      return { diagnosticId: payload.diagnosticId, status: String(payload.status) };
    },
  });
}
