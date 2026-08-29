import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const dashboardUrl = new URL("../../src/modules/integrations/pages/MexalDashboard.jsx", import.meta.url);

test("la card Ordini include OCT nel testo e nell'esecuzione manuale", () => {
  const source = fs.readFileSync(dashboardUrl, "utf8");
  assert.match(source, /title: "Ordini e OCT"/i);
  assert.match(source, /sincronizza gli ordini cliente OCT/i);
  assert.match(source, /await startMexalSync\("orders"\)[\s\S]*startMexalSync\("oct_orders"\)/i);
});

test("il comando automatico della card governa insieme orders e oct_orders", () => {
  const source = fs.readFileSync(dashboardUrl, "utf8");
  assert.match(source, /syncType === "orders" \? \["orders", "oct_orders"\]/i);
  assert.match(source, /syncSchedules\.orders\.enabled === true && syncSchedules\.oct_orders\.enabled === true/i);
});
