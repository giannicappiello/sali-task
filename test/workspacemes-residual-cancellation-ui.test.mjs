import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { transformWithOxc } from "vite";
import { Window } from "happy-dom";

test("annullamento residuo: mostra RdP55 protetta, richiede motivo e conferma, blocca anteprime fallite", async () => {
  const window = new Window();
  for (const key of ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "HTMLTextAreaElement", "Event", "MouseEvent", "Node"])
    Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? window : window[key] });
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const { createElement, act } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const source = await readFile("src/pages/Production/RdpWorkbench.jsx", "utf8");
  const component = source.slice(source.indexOf("function CancelRequestDialog("), source.indexOf("\nfunction PreviewDialog"));
  let { code } = await transformWithOxc(`import { useState, useEffect } from "react"; const X=()=>null, ShieldAlert=()=>null; const rdpLabel=r=>r.number; ${component}; export default CancelRequestDialog;`, "cancellation.jsx", { jsx: { runtime: "automatic" } });
  code = code.replaceAll('"react"', JSON.stringify(import.meta.resolve("react"))).replaceAll('"react/jsx-runtime"', JSON.stringify(import.meta.resolve("react/jsx-runtime")));
  const { default: Dialog } = await import("data:text/javascript;base64," + Buffer.from(code).toString("base64"));
  const container = document.createElement("div"); document.body.append(container); const root = createRoot(container);
  let finishPreview; const previews = [{ confirmationExternalId: "confirmation", stateHash: "a".repeat(64) }];
  const writes = [];
  const props = { request: { id: "rdp", number: "RDP55" }, busy: false, onClose() {}, onConfirm: (...args) => writes.push(args),
    onPreview: () => new Promise(resolve => { finishPreview = resolve; }) };
  const submit = () => [...container.querySelectorAll("button")].find(button => button.textContent === "Conferma annullamento");
  try {
    await act(async () => { root.render(createElement(Dialog, props)); });
    assert.equal(submit().disabled, true); assert.equal(writes.length, 0);
    await act(async () => { finishPreview({ allowed: true, previews, cancelledOrders: [{ id: 5312, number: "RdP55-02" }], preservedOrders: [{ id: 5311, number: "RdP55" }], blocks: [] }); });
    assert.match(container.textContent, /RdP55-02 \(OP 5312\)/); assert.match(container.textContent, /RdP55 \(OP 5311\).*documenti conservati/);
    assert.equal(submit().disabled, true);
    await act(async () => {
      const field = container.querySelector("textarea");
      Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set.call(field, "Annulla residuo cliente");
      field.dispatchEvent(new window.Event("input", { bubbles: true }));
    });
    await act(async () => { container.querySelector('input[type="checkbox"]').click(); });
    assert.equal(submit().disabled, false);
    await act(async () => { submit().click(); });
    assert.deepEqual(writes, [["Annulla residuo cliente", previews]]);
    await act(async () => { root.render(createElement(Dialog, { ...props, onConfirm: async () => { throw new Error("Stato modificato: ripetere anteprima"); } })); });
    await act(async () => { submit().click(); });
    assert.match(container.textContent, /Stato modificato: ripetere anteprima/); assert.equal(submit().disabled, true);
    assert.equal(container.querySelector('input[type="checkbox"]').checked, false);
    await act(async () => { root.render(createElement(Dialog, { ...props, request: { id: "other" }, onPreview: async () => { throw new Error("MES non raggiungibile"); } })); });
    assert.match(container.textContent, /MES non raggiungibile/); assert.equal(submit().disabled, true);
  } finally { await act(async () => root.unmount()); await window.happyDOM.close(); }
});
