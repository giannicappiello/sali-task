import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { Buffer } from "node:buffer";

export const HMAC_HEADERS = Object.freeze({
  timestamp: "x-workspace-timestamp",
  eventId: "x-workspace-event-id",
  signature: "x-workspace-signature",
});

function bodyHash(body) { return createHash("sha256").update(body).digest("hex"); }
function canonical(method, path, timestamp, eventId, body) {
  return [String(method).toUpperCase(), path, String(timestamp), String(eventId), bodyHash(body)].join("\n");
}

export function signProductionMessage({ method, path, timestamp, eventId, body, secret }) {
  return createHmac("sha256", secret).update(canonical(method, path, timestamp, eventId, body)).digest("hex");
}

export function verifyProductionMessage({ method, path, headers, body, secret, now = Date.now(), maximumSkewMs = 300_000 }) {
  const timestamp = String(headers[HMAC_HEADERS.timestamp] || "");
  const eventId = String(headers[HMAC_HEADERS.eventId] || "").trim();
  const supplied = String(headers[HMAC_HEADERS.signature] || "").trim();
  if (!/^\d+$/.test(timestamp) || !eventId || !/^[a-f\d]{64}$/i.test(supplied) || !secret) return false;
  if (Math.abs(now - Number(timestamp) * 1000) > maximumSkewMs) return false;
  const expected = signProductionMessage({ method, path, timestamp, eventId, body, secret });
  return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(supplied, "hex"));
}
