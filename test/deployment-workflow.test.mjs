import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("la produzione segue pubblica, verifica e promuovi", async () => {
  const [script, packageJson, guide] = await Promise.all([
    read("scripts/deploy-production.mjs"),
    read("package.json"),
    read("docs/DEPLOYMENT_PRODUZIONE.md"),
  ]);
  const deployAt = script.indexOf('"deploy", "--prod"');
  const inspectAt = script.indexOf('"inspect", deploymentUrl');
  const pageCheckAt = script.indexOf('"curl", "/"');
  const promoteAt = script.indexOf('"promote", deploymentUrl');
  const domainCheckAt = script.indexOf('"inspect", `https://${productionDomain}`');

  assert.ok(deployAt >= 0);
  assert.ok(inspectAt > deployAt);
  assert.ok(pageCheckAt > inspectAt);
  assert.ok(promoteAt > pageCheckAt);
  assert.ok(domainCheckAt > promoteAt);
  assert.match(packageJson, /"deploy:production": "node scripts\/deploy-production\.mjs"/);
  assert.match(guide, /pubblica → verifica → promuovi/);
  assert.match(script, /workspace\.progre\.it/);
});

