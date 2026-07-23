const DB_NAME = "progre-workspace-order-cache";
const DB_VERSION = 1;
const STORE_NAME = "responses";
const CACHE_MAX_AGE_MS = 12 * 60 * 60 * 1000;

let installPromise = null;
let originalFetch = null;

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

function requestKey(input) {
  return typeof input === "string" ? input : input.url;
}

function openDatabase() {
  return new Promise((resolve, reject) => {
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
    request.onerror = () => reject(request.error);
  });
}

async function readEntry(key) {
  const db = await openDatabase();
  if (!db) return null;

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readonly");
    const request = transaction.objectStore(STORE_NAME).get(key);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}

async function writeEntry(key, response) {
  if (!response.ok) return;

  const cloned = response.clone();
  const body = await cloned.text();
  const headers = {};
  cloned.headers.forEach((value, name) => {
    headers[name] = value;
  });

  const db = await openDatabase();
  if (!db) return;

  await new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).put({
      key,
      body,
      headers,
      status: cloned.status,
      statusText: cloned.statusText,
      savedAt: Date.now(),
    });
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}

function responseFromEntry(entry) {
  return new Response(entry.body, {
    status: entry.status,
    statusText: entry.statusText,
    headers: entry.headers,
  });
}

async function refreshInBackground(input, init, key) {
  try {
    const response = await originalFetch(input, init);
    await writeEntry(key, response);
  } catch (error) {
    console.warn("Aggiornamento cache dati Ordini non riuscito:", error);
  }
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

      const key = requestKey(input);
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
      writeEntry(key, response).catch((error) => {
        console.warn("Scrittura cache dati Ordini non riuscita:", error);
      });
      return response;
    };

    window.__progreOrderDataFetchCacheInstalled = true;
  });

  return installPromise;
}
