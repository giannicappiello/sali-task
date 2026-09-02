import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Documenti Private usa categorie articolo e layout master-detail", async () => {
  const [page, styles] = await Promise.all([
    readFile(new URL("../src/pages/Documentation/PrivateDocuments.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/Documentation/PrivateDocuments.css", import.meta.url), "utf8"),
  ]);

  for (const label of ["Prodotti finiti", "Bulk / semilavorati", "Materie prime", "Altro"]) {
    assert.match(page, new RegExp(label.replace("/", "\\/"), "i"));
  }
  assert.match(page, /articleSection\(article\) === activeSection/);
  assert.match(page, /catalog\.reduce/);
  assert.match(page, /appliedQuery \? articles/);
  assert.match(page, /CATALOG_ARTICLE_TYPES/);
  assert.match(page, /Promise\.all\(CATALOG_ARTICLE_TYPES\.map/);
  assert.match(page, /rows\.filter\(\(article\) => article\.articleType === type\)/);
  assert.match(page, /window\.setTimeout\(\(\) => \{/);
  assert.match(page, /}, 250\)/);
  assert.match(page, /Ricerca rapida in tutti gli articoli/);
  assert.doesNotMatch(page, /private_documents_sync"\)\.then/);
  assert.match(page, /private-documents-master-detail/);
  assert.match(page, /I lotti e i documenti disponibili compariranno qui/);
  const lotsTable = page.match(/<h3>Lotti disponibili<\/h3>([\s\S]*?)<\/section>/)?.[1] || "";
  assert.doesNotMatch(lotsTable, /<th>Origine<\/th>/);
  assert.doesNotMatch(lotsTable, /<th>Magazzino \/ ubicazione<\/th>/);
  assert.match(styles, /\.private-documents-master-detail\{display:grid/);
  assert.match(styles, /grid-template-columns:minmax\(300px,.8fr\) minmax\(0,1.7fr\)/);
});
