import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("il salvataggio modulo accetta descrizione e area nulle", async () => {
  const source = await readFile(new URL("../src/pages/Settings/ModuleManagement.jsx", import.meta.url), "utf8");
  assert.match(source, /const cleanText = \(value\) => String\(value \?\? ""\)\.trim\(\)/);
  assert.match(source, /descrizione: cleanText\(form\.descrizione\) \|\| null/);
  assert.match(source, /area: cleanText\(form\.area\) \|\| null/);
  assert.doesNotMatch(source, /form\.(?:descrizione|area)\.trim\(\)/);
});

test("il salvataggio di aree e menu accetta campi testuali nulli", async () => {
  const source = await readFile(new URL("../src/pages/Settings/MenuManagement.jsx", import.meta.url), "utf8");
  assert.match(source, /const cleanText = \(value\) => String\(value \?\? ""\)\.trim\(\)/);
  assert.match(source, /descrizione: cleanText\(areaForm\.descrizione\) \|\| null/);
  assert.match(source, /descrizione: cleanText\(menuForm\.descrizione\) \|\| null/);
  assert.doesNotMatch(source, /(?:areaForm|menuForm)\.(?:nome|descrizione)\.trim\(\)/);
});
