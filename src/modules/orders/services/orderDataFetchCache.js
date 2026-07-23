const DB_NAME = "progre-workspace-order-cache";
const DB_VERSION = 1;
const STORE_NAME = "responses";
const CACHE_MAX_AGE_MS = 12 * 60 * 60 * 1000;
const REFRESH_COOLDOWN_MS = 10 * 60 * 1000;

let installPromise = null;
let originalFetch = null;
let databasePromise = null;

const memoryCache = new Map();
const refreshesInFlight = new Map();
const lastRefreshAt = new Map();

function isCacheableRequest(input, init = {}) {
  const method = String(init.method || (input instanceof Request ? input.method : "GET")).toUpperCase();
  if (method !== "GET") return false;

  const url = typeof input === "string" ? input : input?.url;
  if (!url || !url.includes("/rest/v1/")) return false;

  return [
    "/ordini_prodotti_cache",
    "/ordini_clienti_cache",
    "/ordini_sconti_listini",
    "/ordini_particolarita",
    "/ordini_regole_pagamento",
    "/prodotti",
  ].some((segment) => url.includes(segment));
}

function shortHash(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function requestKey(input, init = {}) {
  const url = typeof input === "string" ? input : input.url;
  const headers = new Headers(input instanceof Request ? input.headers : undefined);
  new Headers(init.headers || {}).forEach((value, name) => headers.set(name, value));
  const authorization = headers.get("authorization") || "anonymous";
  return `${shortHash(authorization)}::${url}`;
}

function openDatabase() {
  if (databasePromise) return databasePromise;

  databasePromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      resolve(null);
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      databasePromise = null;
      reject(request.error);
    };
  });

  return databasePromise;
}

async function readEntry(key) {
  const inMemory = memoryCache.get(key);
  if (inMemory) return inMemory;

  const db = await openDatabase();
  if (!db) return null;

  const entry = await new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readonly");
    const request = transaction.objectStore(STORE_NAME).get(key);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });

  if (entry) memoryCache.set(key, entry);
  return entry;
}

async function responseToEntry(key, response) {
  if (!response.ok) return null;

  const cloned = response.clone();
  const body = await cloned.text();
  const headers = {};
  cloned.headers.forEach((value, name) => {
    headers[name] = value;
  });

  return {
    key,
    body,
    headers,
    status: cloned.status,
    statusText: cloned.statusText,
    savedAt: Date.now(),
  };
}

async function persistEntry(entry) {
  if (!entry) return;

  memoryCache.set(entry.key, entry);

  const db = await openDatabase();
  if (!db) return;

  await new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).put(entry);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}

async function cacheResponse(key, response) {
  const entry = await responseToEntry(key, response);
  if (!entry) return;

  memoryCache.set(key, entry);
  persistEntry(entry).catch((error) => {
    console.warn("Persistenza cache dati Ordini non riuscita:", error);
  });
}

function responseFromEntry(entry) {
  return new Response(entry.body, {
    status: entry.status,
    statusText: entry.statusText,
    headers: entry.headers,
  });
}

function shouldRefresh(key) {
  const lastRefresh = Number(lastRefreshAt.get(key) || 0);
  return Date.now() - lastRefresh >= REFRESH_COOLDOWN_MS;
}

function refreshInBackground(input, init, key) {
  if (!shouldRefresh(key)) return;
  if (refreshesInFlight.has(key)) return;

  lastRefreshAt.set(key, Date.now());

  const refreshPromise = originalFetch(input, init)
    .then(async (response) => {
      await cacheResponse(key, response);
    })
    .catch((error) => {
      console.warn("Aggiornamento cache dati Ordini non riuscito:", error);
    })
    .finally(() => {
      refreshesInFlight.delete(key);
    });

  refreshesInFlight.set(key, refreshPromise);
}

export function installOrderDataFetchCache() {
  if (installPromise) return installPromise;

  installPromise = Promise.resolve().then(() => {
    if (typeof window === "undefined" || typeof window.fetch !== "function") return;
    if (window.__progreOrderDataFetchCacheInstalled) return;

    originalFetch = window.fetch.bind(window);

    window.fetch = async (input, init = {}) => {
      if (!isCacheableRequest(input, init)) {
        return originalFetch(input, init);
      }

      const key = requestKey(input, init);

      const inMemory = memoryCache.get(key);
      if (inMemory) {
        const age = Date.now() - Number(inMemory.savedAt || 0);
        if (age <= CACHE_MAX_AGE_MS) {
          refreshInBackground(input, init, key);
          return responseFromEntry(inMemory);
        }
      }

      try {
        const cached = await readEntry(key);
        if (cached) {
          const age = Date.now() - Number(cached.savedAt || 0);
          if (age <= CACHE_MAX_AGE_MS) {
            refreshInBackground(input, init, key);
            return responseFromEntry(cached);
          }
        }
      } catch (error) {
        console.warn("Lettura cache dati Ordini non riuscita:", error);
      }

      const response = await originalFetch(input, init);
      cacheResponse(key, response).catch((error) => {
        console.warn("Scrittura cache dati Ordini non riuscita:", error);
      });
      return response;
    };

    window.__progreOrderDataFetchCacheInstalled = true;
  });

  return installPromise;
}
