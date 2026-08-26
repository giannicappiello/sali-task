// @ts-check

import { createProgremesClient, ProgremesClientError, PROGREMES_ALLOWED_RESOURCES } from "./progremes-readonly-client.js";
import { requireProgremesReadonlyAccess } from "./progremes-readonly-auth.js";
import { decorateProductionHealth } from "./workspace-production-gates.js";

/** @param {unknown} value */
function singleResource(value) {
  if (Array.isArray(value)) return "";
  return String(value ?? "").trim();
}

/**
 * @param {import("node:http").IncomingMessage & { method?: string, query?: Record<string, unknown> }} req
 * @param {{ status(code: number): any, json(payload: unknown): any, setHeader(name: string, value: string): void }} res
 * @param {{ authorize?: (request: unknown) => Promise<unknown>, clientFactory?: () => { request(resource: any, query?: Record<string, unknown>): Promise<unknown> }, logger?: Pick<Console, "error">, env?: Record<string, string | undefined> }} [dependencies]
 */
export async function handleProgremesReadonlyRequest(req, res, dependencies = {}) {
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Metodo non consentito.", code: "METHOD_NOT_ALLOWED" });
  }

  const authorize = dependencies.authorize ?? requireProgremesReadonlyAccess;
  const clientFactory = dependencies.clientFactory ?? createProgremesClient;
  const logger = dependencies.logger ?? console;

  try {
    await authorize(req);
    const requestedResource = singleResource(req.query?.resource);
    if (!PROGREMES_ALLOWED_RESOURCES.includes(requestedResource)) {
      throw new ProgremesClientError("RESOURCE_NOT_ALLOWED", "Risorsa ProgreMES non consentita.", { status: 404 });
    }
    const resource = /** @type {import("./progremes-readonly-types").ProgremesResource} */ (requestedResource);
    const client = clientFactory();
    const upstreamPayload = await client.request(resource, req.query ?? {});
    const payload = resource === "diagnostics-health"
      ? decorateProductionHealth(upstreamPayload, dependencies.env ?? globalThis.process.env)
      : upstreamPayload;
    return res.status(200).json(payload);
  } catch (error) {
    const status = error instanceof ProgremesClientError
      ? error.status
      : Number(/** @type {{ status?: unknown }} */ (error)?.status ?? 500);
    const safeStatus = Number.isInteger(status) && status >= 400 && status <= 599 ? status : 500;
    const code = error instanceof ProgremesClientError ? error.code : safeStatus === 401 ? "UNAUTHORIZED" : safeStatus === 403 ? "FORBIDDEN" : "INTERNAL_ERROR";
    const message = safeStatus < 500 && error instanceof Error ? error.message : "Integrazione ProgreMES temporaneamente non disponibile.";
    if (safeStatus >= 500) logger.error("Workspace ProgreMES read-only proxy failed", { code, status: safeStatus });
    return res.status(safeStatus).json({
      error: message,
      code,
      ...(error instanceof ProgremesClientError && error.upstreamStatus ? { upstreamStatus: error.upstreamStatus } : {}),
    });
  }
}
