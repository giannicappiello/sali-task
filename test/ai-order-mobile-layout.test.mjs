import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const css = readFileSync("src/modules/orders/orders-module.css", "utf8");
const dialog = readFileSync("src/modules/orders/components/AIOrderTypeDialog.jsx", "utf8");

test("il popup AI mobile resta compatto e non forza più l'altezza dello schermo", () => {
  const mobileSection = css.slice(css.lastIndexOf("@media(max-width:600px)"));
  assert.match(mobileSection, /left:0;right:auto;width:100dvw/);
  assert.match(mobileSection, /place-items:start/);
  assert.match(mobileSection, /width:min\(340px,calc\(100vw - 40px\)\)/);
  assert.match(mobileSection, /max-height:calc\(100dvh - max\(124px/);
  assert.match(mobileSection, /overflow-x:hidden/);
  assert.match(mobileSection, /overflow-y:auto/);
  assert.match(mobileSection, /border-radius:18px/);
  assert.doesNotMatch(mobileSection, /min-height:100vh/);
});

test("il popup è montato sul body e non viene centrato rispetto al layout largo della pagina", () => {
  assert.match(dialog, /createPortal/);
  assert.match(dialog, /document\.body/);
});

test("titolo e descrizione non possono allargare il popup con il testo ingrandito", () => {
  assert.match(css, /\.orders-ai-type-heading>div\{width:100%;min-width:0\}/);
  assert.match(css, /font-size:clamp\(1\.05rem,5vw,1\.25rem\)/);
  assert.match(css, /overflow-wrap:anywhere/);
});

test("il nome del file acquisito può andare a capo senza allargare la pagina", () => {
  assert.match(css, /grid-template-columns:58px minmax\(0,1fr\)/);
  assert.match(css, /word-break:break-word/);
});
