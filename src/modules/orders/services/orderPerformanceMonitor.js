const TABLES = [
  "ordini_clienti_cache",
  "ordini_prodotti_cache",
  "ordini_sconti_listini",
  "ordini_particolarita",
  "ordini_regole_pagamento",
  "prodotti",
];

let installed = false;
let originalFetch = null;
let sessionStartedAt = 0;
let requestRows = [];
let renderRows = [];
let printTimer = null;

function tableFromUrl(url) {
  return TABLES.find((table) => url.includes(`/rest/v1/${table}`)) || null;
}

function schedulePrint() {
  window.clearTimeout(printTimer);
  printTimer = window.setTimeout(() => {
    const totalMs = sessionStartedAt ? performance.now() - sessionStartedAt : 0;
    const requests = requestRows.map((row) => ({
      fase: row.table,
      tipo: "richiesta dati",
      durata_ms: Number(row.duration.toFixed(1)),
      stato: row.status,
    }));
    const renders = renderRows.map((row) => ({
      fase: `React ${row.phase}`,
      tipo: "render",
      durata_ms: Number(row.actualDuration.toFixed(1)),
      stato: "ok",
    }));

    console.group("⏱ Misurazione Nuovo Ordine");
    console.table([
      ...requests,
      ...renders,
      {
        fase: "TOTALE dalla navigazione",
        tipo: "totale",
        durata_ms: Number(totalMs.toFixed(1)),
        stato: "misurato",
      },
    ]);
    console.log("Dettaglio richieste:", requestRows);
    console.log("Dettaglio render React:", renderRows);
    console.groupEnd();
  }, 600);
}

export function beginNewOrderMeasurement() {
  sessionStartedAt = performance.now();
  requestRows = [];
  renderRows = [];
  console.info("⏱ Avvio misurazione Nuovo Ordine");
  schedulePrint();
}

export function recordNewOrderRender(id, phase, actualDuration, baseDuration, startTime, commitTime) {
  renderRows.push({ id, phase, actualDuration, baseDuration, startTime, commitTime });
  schedulePrint();
}

export function installNewOrderPerformanceMonitor() {
  if (installed || typeof window === "undefined" || typeof window.fetch !== "function") return;
  installed = true;
  originalFetch = window.fetch.bind(window);

  window.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input?.url || "";
    const table = tableFromUrl(url);
    if (!table || !sessionStartedAt) return originalFetch(input, init);

    const startedAt = performance.now();
    try {
      const response = await originalFetch(input, init);
      requestRows.push({
        table,
        duration: performance.now() - startedAt,
        status: response.status,
        url,
      });
      schedulePrint();
      return response;
    } catch (error) {
      requestRows.push({
        table,
        duration: performance.now() - startedAt,
        status: "errore",
        url,
        error: error?.message,
      });
      schedulePrint();
      throw error;
    }
  };
}
