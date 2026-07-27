function value(name) {
  return String(globalThis.process?.env?.[name] || "").trim();
}

export async function triggerArubaOrderEmailWorker({ fetchImpl = fetch } = {}) {
  const url = value("ARUBA_EMAIL_WORKER_URL");
  const secret = value("ARUBA_EMAIL_WORKER_SECRET");
  if (!url || !secret) return { status: "not_configured" };

  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Progre-Worker-Secret": secret,
      },
      body: JSON.stringify({ action: "run", source: "workspace" }),
      signal: AbortSignal.timeout(90_000),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload?.error || `Worker Aruba HTTP ${response.status}`);
    }
    return {
      status: payload?.status || "ok",
      processed: Array.isArray(payload?.results)
        ? payload.results.filter((item) => item?.status === "sent").length
        : 0,
    };
  } catch (error) {
    console.error("Aruba order email worker dispatch failed", {
      error: error.message,
    });
    return { status: "error", error: error.message };
  }
}
