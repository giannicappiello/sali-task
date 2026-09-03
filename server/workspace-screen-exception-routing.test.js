import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("un consenso esplicito sulla schermata attraversa modulo e area padre", async () => {
  const [auth, guard, layout] = await Promise.all([
    read("src/contexts/AuthContext.jsx"),
    read("src/components/WorkspaceAccessGuard.jsx"),
    read("src/components/WorkspaceScreenLayout.jsx"),
  ]);
  assert.match(auth, /function hasExplicitScreenGrant\(screenCode\)/);
  assert.match(auth, /function getModuleScreenGrant\(moduleCode\)/);
  assert.match(guard, /hasModuleAccess\(moduleCode\) \|\| screenGranted/);
  assert.match(layout, /!hasAreaAccess\(screen\.area\) && !hasExplicitScreenGrant\(screen\.codice\)/);
});

test("menu e contenitore rendono raggiungibile la schermata concessa", async () => {
  const [menu, moduleContainer, layout] = await Promise.all([
    read("src/pages/Modules/WorkspaceMenuContainer.jsx"),
    read("src/pages/Modules/WorkspaceModuleContainer.jsx"),
    read("src/components/Layout.jsx"),
  ]);
  assert.match(menu, /getModuleScreenGrant\(module\.codice\)/);
  assert.match(moduleContainer, /hasAreaAccess\(screen\.area\) \|\| hasExplicitScreenGrant\(screen\.codice\)/);
  assert.match(layout, /screenGrant && !hasModuleAccess\(itemModuleCode\)/);
});

test("il perimetro dati cliente resta indipendente dalla navigazione", async () => {
  const auth = await read("src/contexts/AuthContext.jsx");
  assert.match(auth, /customerCode: scopeContext\?\.customer_code \|\| null/);
  assert.match(auth, /customerCodes: Array\.isArray\(scopeContext\?\.customer_codes\)/);
});
