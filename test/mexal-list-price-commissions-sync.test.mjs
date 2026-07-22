import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import {
  extractListPriceCommissionRows,
  normalizeListPriceCommission,
  LIST_PRICE_COMMISSIONS_ENDPOINT,
} from "../server/mexal/sync-list-price-commissions.js";

test("estrae le righe dai wrapper Mexal supportati", () => {
  const rows = [{ cod_cat_cli: 2, cod_cat_art: 3, provvigione: 7.5, tipo: "%" }];
  assert.deepEqual(extractListPriceCommissionRows({ dati: rows }), rows);
  assert.deepEqual(extractListPriceCommissionRows({ records: rows }), rows);
  assert.deepEqual(extractListPriceCommissionRows(rows), rows);
  assert.equal(LIST_PRICE_COMMISSIONS_ENDPOINT, "/dati-generali/provvigioni-listini");
});

test("normalizza la matrice cliente articolo usando i campi reali Mexal", () => {
  const synchronizedAt = "2026-07-22T12:00:00.000Z";
  const row = normalizeListPriceCommission({
    cod_cat_cli: 2,
    cod_cat_art: 4,
    provvigione: 12.5,
    tipo: "%",
    formula: "12,5",
    cod_agente: "602.00040",
    cod_cond_agente: 3,
  }, synchronizedAt);

  assert.equal(row.categoria_cliente, 2);
  assert.equal(row.categoria_prodotto, 4);
  assert.equal(row.percentuale, 12.5);
  assert.equal(row.codice_agente_mexal, "602.00040");
  assert.equal(row.codice_condizione_agente_mexal, 3);
  assert.equal(row.tipo_provvigione_mexal, "%");
  assert.equal(row.formula_mexal, "12,5");
  assert.equal(row.origine, "mexal_provvigioni_listini");
  assert.equal(row.attiva, true);
  assert.equal(row.sincronizzato_il, synchronizedAt);
});

test("mantiene le combinazioni a zero come regole inattive", () => {
  const row = normalizeListPriceCommission({ cod_cat_cli: 3, cod_cat_art: 8, provvigione: 0, tipo: "", formula: "" });
  assert.equal(row.percentuale, 0);
  assert.equal(row.attiva, false);
});

test("rifiuta categorie e percentuali non valide", () => {
  assert.throws(() => normalizeListPriceCommission({ cod_cat_cli: 0, cod_cat_art: 2, provvigione: 5 }), /Categoria cliente/);
  assert.throws(() => normalizeListPriceCommission({ cod_cat_cli: 2, cod_cat_art: 0, provvigione: 5 }), /Categoria articolo/);
  assert.throws(() => normalizeListPriceCommission({ cod_cat_cli: 2, cod_cat_art: 3, provvigione: 101 }), /Percentuale/);
});

test("integra avvio manuale, pianificazione e storico condiviso", async () => {
  const [endpoint, dispatcher, migration, service, ui] = await Promise.all([
    fs.readFile(new URL("../api/mexal/sync-list-price-commissions.js", import.meta.url), "utf8"),
    fs.readFile(new URL("../api/cron/mexal-dispatcher.js", import.meta.url), "utf8"),
    fs.readFile(new URL("../supabase/migrations/20260722130000_mexal_list_price_commissions_sync.sql", import.meta.url), "utf8"),
    fs.readFile(new URL("../src/modules/integrations/services/mexalAutomationService.js", import.meta.url), "utf8"),
    fs.readFile(new URL("../src/modules/integrations/components/MexalAutomations.jsx", import.meta.url), "utf8"),
  ]);

  assert.match(endpoint, /syncListPriceCommissions/);
  assert.match(endpoint, /CRON_SECRET/);
  assert.match(dispatcher, /list_price_commissions/);
  assert.match(migration, /mexal_sync_schedules/);
  assert.match(migration, /list_price_commissions/);
  assert.match(service, /runListPriceCommissionsNow/);
  assert.match(service, /\/api\/mexal\/sync-list-price-commissions/);
  assert.match(ui, /Esegui ora/);
  assert.match(ui, /Provvigioni listini sincronizzate/);
});
