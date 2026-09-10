import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isProgremesFrameMessage, isProgremesScreenPath, openProgremesWorkspaceWindow, progremesWorkspacePath, requestProgremesNavigation } from "./progremesWindow.js";

test("la nuova finestra usa una route Workspace preservando il contesto", () => {
  assert.equal(progremesWorkspacePath("/produzione/progremes.Planning?odpId=42&workspaceMesWindow=1#piano"), "/produzione/progremes.Planning?odpId=42&workspaceMesWindow=1#piano");
  assert.equal(progremesWorkspacePath("/progremes/accesso"), "/progremes/accesso?workspaceMesWindow=1");
  assert.throws(() => progremesWorkspacePath("https://external.example/test"), /non valida/);
  assert.throws(() => progremesWorkspacePath("//external.example/test"), /non valida/);
});

test("SSO conserva schermo e contesto senza propagare il vecchio parametro popup", async () => {
  const controller = new AbortController();
  const url = await requestProgremesNavigation("test-token", {
    screenCode: "progremes.Planning", search: "?odpId=42&article=FP002&workspaceMesWindow=1",
    signal: controller.signal,
    fetcher: async (path, options) => {
      assert.equal(path, "/api/mexal/automation");
      assert.equal(options.method, "POST");
      assert.equal(options.headers.Authorization, "Bearer test-token");
      assert.equal(options.signal, controller.signal);
      assert.deepEqual(JSON.parse(options.body), { action: "progremes_sso", screenCode: "progremes.Planning", context: { odpId: "42", article: "FP002" } });
      return { ok: true, json: async () => ({ url: "https://mes.example/Account/WorkspaceSso?ticket=test" }) };
    },
  });
  assert.equal(url, "https://mes.example/Account/WorkspaceSso?ticket=test");
});

test("il lancio generale usa lo stesso endpoint SSO senza schermata obbligatoria", async () => {
  await requestProgremesNavigation("test", { fetcher: async (_, options) => {
    assert.deepEqual(JSON.parse(options.body), { action: "progremes_sso" });
    return { ok: true, json: async () => ({ url: "https://mes.example/" }) };
  } });
});

test("sessione assente, diniego SSO, risposta non valida e annullamento non causano navigazione", async () => {
  await assert.rejects(requestProgremesNavigation("", { fetcher: () => assert.fail("No session must not make a request") }), /Sessione/);
  await assert.rejects(requestProgremesNavigation("test", { fetcher: async () => ({ ok: false, json: async () => ({ error: "Non autorizzato" }) }) }), /Non autorizzato/);
  await assert.rejects(requestProgremesNavigation("test", { fetcher: async () => ({ ok: true, json: async () => ({}) }) }), /Impossibile/);
  await assert.rejects(requestProgremesNavigation("test", { fetcher: async () => ({ ok: true, json: async () => ({ url: "javascript:alert(1)" }) }) }), /non valida/);
  await assert.rejects(requestProgremesNavigation("test", { fetcher: async () => { throw new DOMException("Cancelled", "AbortError"); } }), { name: "AbortError" });
});

test("menu, home, cataloghi, RdP e notifiche aprono nuove finestre Workspace con MES incorporato", () => {
  const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
  const layout = read("../../components/Layout.jsx");
  const home = read("../Home/Home.jsx");
  const catalog = read("../Modules/WorkspaceModuleContainer.jsx");
  const production = read("../Production/Production.jsx");
  const launch = read("./ProgreMesLaunch.jsx");
  const workbench = read("../Production/RdpWorkbench.jsx");
  const notifications = read("../Notifications/Notifications.jsx");
  assert.match(layout, /openProgremesWorkspaceWindow\(destination\)/);
  assert.match(home, /detail: \{ workspacePath:/);
  assert.match(layout, /event\.detail\?\.workspacePath/);
  for (const source of [layout, home, catalog, production, launch]) {
    assert.doesNotMatch(source, /markProgremesPopup|openPendingProgremesWindow|isProgremesPopup/);
  }
  for (const source of [home, catalog, production]) assert.doesNotMatch(source, /external:/);
  assert.doesNotMatch(launch, /window\.open|_blank/);
  assert.doesNotMatch(launch, /window.location.assign|window.location.replace/);
  assert.match(launch, /<iframe ref=\{frame\} key=\{url\} src=\{url\}/);
  assert.match(launch, /isProgremesFrameMessage\(event, frame.current\?\.contentWindow, origin\)/);
  assert.doesNotMatch(launch, /allow-top-navigation/);
  assert.match(workbench, /requestProgremesWorkspaceWindow\(productionOrderProgremesPath\(result\)\)/);
  assert.doesNotMatch(workbench, /window.location.assign\(productionOrderProgremesPath/);
  assert.match(notifications, /requestProgremesWorkspaceWindow\(target.pathname \+ target.search\)/);
  assert.match(launch, /return \(\) => controller.abort\(\)/);
  assert.match(launch, /authLoading \|\| !accessToken \|\| !allowed/);
  assert.match(production, /<ProgreMesLaunch key=\{sectionCode\} screenCode=\{sectionCode\} search=\{location.search\}/);
});

test("l'apertura non naviga o chiude mai la finestra originaria e non riutilizza altre finestre", () => {
  let count = 0;
  const parent = { open: (path, target, features) => {
    assert.equal(path, "/produzione/progremes.Planning?workspaceMesWindow=1");
    assert.equal(target, "_blank");
    assert.match(features, /popup/);
    count++;
    return { opener: parent };
  }, close: () => assert.fail("Original must stay open"), location: { assign: () => assert.fail("Original must not navigate") } };
  const first = openProgremesWorkspaceWindow("/produzione/progremes.Planning", parent);
  const second = openProgremesWorkspaceWindow("/produzione/progremes.Planning", parent);
  assert.notEqual(first, second);
  assert.equal(first.opener, null);
  assert.equal(count, 2);
  assert.throws(() => openProgremesWorkspaceWindow("/produzione", { open: () => null }), /Consenti/);
});

test("riconosce solo link MES interni, senza trasformare schermate Workspace o siti esterni", () => {
  for (const path of ["/produzione/progremes.Planning", "/produzione/progremes.Ordini.Produzione?odpId=1", "/progremes/accesso"]) assert.equal(isProgremesScreenPath(path), true);
  for (const path of ["/produzione", "/produzione/rdp-workbench", "/produzione/fabbisogni-acquisto", "/produzione/diagnostica", "/tasks", "https://external.example/produzione/Planning"]) assert.equal(isProgremesScreenPath(path), false);
});

test("i messaggi MES devono provenire dal frame e dall'origine attesa", () => {
  const frame = {};
  const event = { source: frame, origin: "https://mes.example", data: { type: "progremes-embedded-ready" } };
  assert.equal(isProgremesFrameMessage(event, frame, event.origin), true);
  assert.equal(isProgremesFrameMessage({ ...event, source: {} }, frame, event.origin), false);
  assert.equal(isProgremesFrameMessage({ ...event, origin: "https://evil.example" }, frame, event.origin), false);
  assert.equal(isProgremesFrameMessage({ ...event, data: { type: "navigate", url: "https://evil.example" } }, frame, event.origin), false);
  assert.equal(isProgremesFrameMessage(event, null, event.origin), false);
});
