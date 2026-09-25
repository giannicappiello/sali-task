export async function requestStockBatch(request, payload, { isCancelled = () => false, onRetry = () => {}, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), maxRetries = 5 } = {}) {
  for (let attempt = 0; ; attempt += 1) {
    if (isCancelled()) throw Object.assign(new Error('Sincronizzazione annullata.'), { cancelled: true });
    try {
      return await request({ ...payload, resume: attempt > 0 || payload.resume });
    } catch (error) {
      const status = Number(error.status || 0);
      const transient = [408, 429, 500, 502, 503, 504].includes(status)
        || (!status && /timeout|fetch failed|failed to fetch|network/i.test(error.message || ''));
      if (!transient || attempt >= maxRetries) throw error;
      onRetry({ attempt: attempt + 1 });
      await sleep(Math.min(30000, 2000 * 2 ** attempt));
    }
  }
}
