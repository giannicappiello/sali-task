import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const classification = read("src/modules/crm/CustomerClassificationPanel.jsx");
const crm = read("src/modules/crm/CrmModule.jsx");
const digital = read("src/modules/crm/DigitalCommerce.jsx");
const layout = read("src/components/Layout.jsx");

test("KPI amministrazione CRM usano l'intero dataset filtrato", () => {
  assert.match(classification, /loadAllQueryRows/);
  assert.match(classification, /query\.range\(from, to\)/);
  assert.match(classification, /DistributionChart/);
  assert.match(classification, /intero dataset/);
});

test("card CRM aprono drill-down e persistono i filtri in query string", () => {
  assert.match(classification, /classification_area/);
  assert.match(classification, /classification_macro/);
  assert.match(classification, /CrmCustomerStatusFilter/);
  assert.match(classification, /apri elenco filtrato/);
  assert.match(crm, /period\.withPeriod\(`\$\{config\.basePath\}\/pipeline`/);
  assert.match(digital, /drilldown\("\/crm\/online\/clienti", "identified"\)/);
});

test("CRM Conto Terzi, B2B, Online e AI restano nella gabbia Workspace standard", () => {
  assert.match(layout, /<WorkspaceScreenLayout/);
  assert.match(crm, /ModuleContainerLayout/);
  for (const className of ["panel crm-panel", "kpi-card crm-kpi", "primary-action crm-primary", "secondary-action crm-secondary"]) {
    assert.match(crm, new RegExp(className));
  }
  assert.match(crm, /lucide-react/);
});
