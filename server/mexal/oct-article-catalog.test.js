import test from "node:test";
import assert from "node:assert/strict";
import { inspectMissingOctArticles, recoverOctArticleReferences } from "./oct-article-catalog.js";

function client(articles, { groupFailure = false } = {}) {
  return { async getJson(path) {
    if (path === "/dati-generali/gruppi-merceologici") {
      if (groupFailure) throw new Error("offline");
      return { dati: [{ codice: "B", descrizione: "Brand" },
        { codice: "LIVE", cod_grp_merc: "B", descrizione: "Linea attiva" },
        { codice: "OLD", cod_grp_merc: "B", descrizione: "Sali di Ischia Fuori Produzione" }] };
    }
    const code = decodeURIComponent(path.split("/").at(-1));
    if (!articles[code]) throw new Error("not found");
    return articles[code];
  } };
}
const article = (codice, extra = {}) => ({ codice, gest_annullato: "N", gest_precanc: "N", cod_grp_merc: "LIVE", um_principale: "PZ", ...extra });

test("recovers active CMP references but keeps IT0064 out of production excluded", async () => {
  const result = await inspectMissingOctArticles({ codes: ["IT0064", "IT0472-CMP", "IT0472-CMP"], mexal: client({
    IT0064: article("IT0064", { cod_grp_merc: "OLD" }), "IT0472-CMP": article("IT0472-CMP"),
  }) });
  assert.equal(result.diagnostics.length, 2);
  assert.equal(result.diagnostics[0].reason, "ARTICLE_OUT_OF_PRODUCTION");
  assert.equal(result.diagnostics[0].recoverable, false);
  assert.deepEqual(result.eligible.map(row => row.codice_articolo), ["IT0472-CMP"]);
  assert.equal(result.eligible[0].mostra_in_app, false);
  assert.equal(result.eligible[0].unita_misura, "PZ");
  assert.equal("dati_mexal" in result.diagnostics[1], false);
});

test("never restores cancelled, mismatched, unreadable or unknown-hierarchy articles", async () => {
  const result = await inspectMissingOctArticles({ codes: ["A", "B", "C", "D", "E"], mexal: client({
    A: article("A", { gest_annullato: "S" }), B: article("B", { gest_precanc: "S" }),
    C: article("OTHER"), D: article("D", { cod_grp_merc: "UNKNOWN" }),
  }) });
  assert.deepEqual(result.eligible, []);
  assert.deepEqual(result.diagnostics.map(d => d.reason), ["ARTICLE_INACTIVE", "ARTICLE_INACTIVE", "ARTICLE_CODE_MISMATCH", "ARTICLE_HIERARCHY_UNKNOWN", "ARTICLE_READ_FAILED"]);
});

test("group lookup failure cannot silently admit a discontinued article", async () => {
  const result = await inspectMissingOctArticles({ codes: ["IT0064"], mexal: client({ IT0064: article("IT0064", { cod_grp_merc: "OLD" }) }, { groupFailure: true }) });
  assert.equal(result.eligible.length, 0);
  assert.equal(result.diagnostics[0].reason, "ARTICLE_HIERARCHY_UNKNOWN");
});

test("recovery writes only missing references and preserves concurrent catalogue changes", async () => {
  const calls = [];
  await recoverOctArticleReferences({ eligible: [{ codice_articolo: "CMP", mostra_in_app: false }], supabase: {
    from(table) { return { async upsert(row, options) { calls.push({ table, row, options }); return { error: null }; } }; },
  } });
  assert.deepEqual(calls, [{ table: "ordini_prodotti_cache", row: { codice_articolo: "CMP", mostra_in_app: false }, options: { onConflict: "codice_articolo", ignoreDuplicates: true } }]);
  await assert.rejects(() => recoverOctArticleReferences({ eligible: [{ codice_articolo: "CMP" }], supabase: {
    from() { return { async upsert() { return { error: { message: "secret database detail" } }; } }; },
  } }), /Recupero anagrafica OCT non riuscito per CMP/);
});

test("no missing articles requires no Mexal reads or database writes", async () => {
  const result = await inspectMissingOctArticles({ codes: [], mexal: null });
  assert.deepEqual(result, { diagnostics: [], eligible: [] });
  await recoverOctArticleReferences({ supabase: null, eligible: [] });
});
