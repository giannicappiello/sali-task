import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const appCss = await readFile(new URL("../src/styles/App.css", import.meta.url), "utf8");

test("KPI cards center every element and their text on smartphones", () => {
  assert.match(appCss, /@media \(max-width: 700px\)/);
  assert.match(appCss, /\.app-shell :is\([\s\S]*\.kpi-card,[\s\S]*\.crm-control-kpi,[\s\S]*\.purchase-summary > button,[\s\S]*\.warehouse-dashboard-kpis > article/);
  assert.match(appCss, /align-items: center;[\s\S]*justify-content: center;[\s\S]*justify-items: center;[\s\S]*text-align: center;/);
  assert.match(appCss, /\.product-kpi, \.project-kpi, \.calendar-kpi\)[\s\S]*flex-direction: column;/);
  assert.match(appCss, /\.crm-classification-kpis button\.kpi-card,[\s\S]*text-align: center;/);
  assert.match(appCss, /:is\(span, small, p, strong, em, h3, dt, dd\)[\s\S]*text-align: center;/);
});
