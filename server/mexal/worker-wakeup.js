import { waitUntil } from "@vercel/functions";

// The destination is fixed, never derived from a caller-controlled Host header.
export function wakeMexalWorker({ manualJobId = null, continuation = false } = {}) {
  const secret = globalThis.process?.env?.WORKER_SECRET;
  if (!secret) return;
  waitUntil(fetch("https://workspace.progre.it/api/mexal/queue-worker", {
    method: "POST",
    headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
    body: JSON.stringify({ background: true, manualJobId, continuation }),
    signal: AbortSignal.timeout(15000),
  }).then((response) => {
    if (!response.ok) throw new Error(`Worker wake-up HTTP ${response.status}`);
  }).catch((error) => console.warn("Mexal worker wake-up deferred to scheduled retry:", error.message)));
}
