export const MEXAL_TRANSIENT_MAX_RETRIES = 3;
export const MEXAL_TRANSIENT_BACKOFF_MS = 500;
export const MEXAL_TRANSIENT_MAX_BACKOFF_MS = 4000;

const TRANSIENT_STATUS_CODES = new Set([408, 425, 429, 502, 503, 504]);
const TRANSIENT_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "EPIPE",
  "EAI_AGAIN",
  "ETIMEDOUT",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
]);
const TRANSIENT_MESSAGE = /\b(?:upstream|network|socket hang up|fetch failed|timeout|timed out|temporar(?:y|ily)|econnreset|eai_again|etimedout)\b/i;

export function isTransientMexalError(error) {
  const status = Number(error?.status || error?.statusCode || error?.mexalResponse?.status || 0);
  if (TRANSIENT_STATUS_CODES.has(status) || status >= 500) return true;
  if (TRANSIENT_CODES.has(String(error?.code || "").toUpperCase())) return true;
  return TRANSIENT_MESSAGE.test(String(error?.message || error || ""));
}

export function transientRetryDelay(attempt, {
  baseDelayMs = MEXAL_TRANSIENT_BACKOFF_MS,
  maxDelayMs = MEXAL_TRANSIENT_MAX_BACKOFF_MS,
} = {}) {
  const safeAttempt = Math.max(1, Number(attempt) || 1);
  return Math.min(maxDelayMs, baseDelayMs * (2 ** (safeAttempt - 1)));
}

const wait = (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs));

export async function withTransientMexalRetry(operation, {
  maxRetries = MEXAL_TRANSIENT_MAX_RETRIES,
  baseDelayMs = MEXAL_TRANSIENT_BACKOFF_MS,
  maxDelayMs = MEXAL_TRANSIENT_MAX_BACKOFF_MS,
  sleep = wait,
  onRetry,
} = {}) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await operation({ attempt: attempt + 1 });
    } catch (error) {
      const transient = isTransientMexalError(error);
      if (!transient || attempt >= maxRetries) {
        if (error && typeof error === "object") {
          error.retryable = transient;
          error.retryAttempts = attempt + 1;
          error.retriesExhausted = transient && attempt >= maxRetries;
        }
        throw error;
      }
      const delayMs = transientRetryDelay(attempt + 1, { baseDelayMs, maxDelayMs });
      onRetry?.({ attempt: attempt + 1, delayMs, error });
      await sleep(delayMs);
    }
  }
}
