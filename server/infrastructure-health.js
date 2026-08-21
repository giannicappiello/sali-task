const DEFAULT_TIMEOUT_MS = 12_000;

export const INFRASTRUCTURE_PROBES = Object.freeze([
  Object.freeze({
    code: "document_gateway",
    name: "Documenti NAS",
    url: "https://files.progredocumenti.it/health",
    acceptedStatuses: [200],
    validateBody: (body) => body?.ok === true && body?.service === "progre-document-gateway",
  }),
  Object.freeze({
    code: "progremes_server",
    name: "Server ProgreMES",
    url: "https://mes.progredocumenti.it/api/workspace/ai/planning/context",
    // 401/403 confermano che PC, tunnel e API rispondono senza esporre credenziali.
    acceptedStatuses: [200, 401, 403],
  }),
]);

export async function runInfrastructureProbe(probe, options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const timeoutMs = Number(options.timeoutMs || DEFAULT_TIMEOUT_MS);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();

  try {
    const response = await fetchImpl(probe.url, {
      method: "GET",
      redirect: "follow",
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    const latencyMs = Date.now() - startedAt;
    let body = null;
    if (probe.validateBody) {
      body = await response.json().catch(() => null);
    }
    const statusAccepted = probe.acceptedStatuses.includes(response.status);
    const bodyAccepted = !probe.validateBody || probe.validateBody(body);
    const ok = statusAccepted && bodyAccepted;
    return {
      code: probe.code,
      name: probe.name,
      url: probe.url,
      ok,
      statusCode: response.status,
      latencyMs,
      error: ok ? null : bodyAccepted
        ? `HTTP ${response.status}`
        : "Risposta del servizio non valida",
    };
  } catch (error) {
    return {
      code: probe.code,
      name: probe.name,
      url: probe.url,
      ok: false,
      statusCode: null,
      latencyMs: Date.now() - startedAt,
      error: error?.name === "AbortError"
        ? `Timeout dopo ${timeoutMs} ms`
        : String(error?.message || error || "Connessione non riuscita").slice(0, 500),
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function runInfrastructureProbes(options = {}) {
  const probes = options.probes || INFRASTRUCTURE_PROBES;
  return Promise.all(probes.map((probe) => runInfrastructureProbe(probe, options)));
}

export async function checkAndRecordInfrastructureHealth(admin, options = {}) {
  const checks = await runInfrastructureProbes(options);
  const transitions = [];
  for (const check of checks) {
    const { data, error } = await admin.rpc("registra_controllo_infrastruttura", {
      p_codice: check.code,
      p_nome: check.name,
      p_url: check.url,
      p_ok: check.ok,
      p_status_code: check.statusCode,
      p_latenza_ms: check.latencyMs,
      p_errore: check.error,
    });
    if (error) throw new Error(`Monitor ${check.code}: ${error.message}`);
    transitions.push(data);
  }
  return { checks, transitions };
}
