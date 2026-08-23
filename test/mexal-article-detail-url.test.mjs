import assert from "node:assert/strict";
import test from "node:test";
import {
  buildArticleDetailPath,
  loadFullArticle,
} from "../server/mexal/sync-products.js";

test("encodes article codes once for each Mexal URL boundary", () => {
  const cases = [
    ["IT0001", "/articoli/IT0001"],
    ["C/ASS", "/articoli/C%252FASS"],
    ["MP3114-SOL.2%", "/articoli/MP3114-SOL.2%2525"],
    ["MAE40-1.BF-T33", "/articoli/MAE40-1.BF-T33"],
    ["A?B#C", "/articoli/A%253FB%2523C"],
  ];

  for (const [code, expectedPath] of cases) {
    const path = buildArticleDetailPath(code);
    assert.equal(path, expectedPath, code);
    assert.equal(
      decodeURIComponent(decodeURIComponent(path.slice("/articoli/".length))),
      code,
      `${code} keeps its original logical value`,
    );
    assert.equal(path.includes("%25252F"), false, `${code} slash is not encoded again`);
    assert.equal(path.includes("%252525"), false, `${code} percent is not encoded again`);
  }
});

test("associates the Mexal detail response with the original article code", async () => {
  const originalCode = "MAE60-L/BF.T33";
  const requestedPaths = [];
  const mexal = {
    async getJson(path) {
      requestedPaths.push(path);
      return { dati: { codice: originalCode, descrizione: "Articolo speciale" } };
    },
  };

  const article = await loadFullArticle(mexal, originalCode);

  assert.deepEqual(requestedPaths, ["/articoli/MAE60-L%252FBF.T33"]);
  assert.equal(article.codice, originalCode);
  assert.equal(article.descrizione, "Articolo speciale");
});
