import { spawnSync } from "node:child_process";

const productionDomain = process.env.PRODUCTION_DOMAIN || "workspace.progre.it";
const npxCommand = process.platform === "win32" ? "npx.cmd" : "npx";

function run(command, args, { allowCurrentProduction = false } = {}) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env: { ...process.env, CI: "1", NO_COLOR: "1" },
    encoding: "utf8",
    shell: false,
  });
  const output = `${result.stdout || ""}${result.stderr || ""}`;
  process.stdout.write(output);
  const alreadyCurrent = allowCurrentProduction && /already the current production deployment/i.test(output);
  if (result.error) throw result.error;
  if (result.status !== 0 && !alreadyCurrent) {
    throw new Error(`Comando non riuscito: ${command} ${args.join(" ")}`);
  }
  return output;
}

function deploymentUrlFrom(output) {
  const jsonMatches = [...output.matchAll(/"url"\s*:\s*"(https:\/\/[^"\s]+\.vercel\.app)"/g)];
  if (jsonMatches.length) return jsonMatches.at(-1)[1];
  const production = output.match(/Production\s+(https:\/\/[^\s]+\.vercel\.app)/i);
  if (production) return production[1];
  const urls = [...output.matchAll(/https:\/\/[a-z0-9-]+\.vercel\.app/gi)].map((match) => match[0]);
  const uniqueDeployment = urls.find((url) => /-[a-z0-9]{6,}-[^.]+\.vercel\.app$/i.test(url));
  if (uniqueDeployment) return uniqueDeployment;
  throw new Error("URL del deployment non rilevato dall'output Vercel.");
}

console.log("\n[1/6] Verifica build locale");
run(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "build"]);

console.log("\n[2/6] Pubblicazione del deployment staged");
const deployOutput = run(npxCommand, ["vercel", "deploy", "--prod", "--yes"]);
const deploymentUrl = deploymentUrlFrom(deployOutput);
console.log(`Deployment candidato: ${deploymentUrl}`);

console.log("\n[3/6] Verifica stato READY");
const inspectOutput = run(npxCommand, ["vercel", "inspect", deploymentUrl]);
if (!/status\s+.*Ready/i.test(inspectOutput)) throw new Error("Il deployment non risulta READY.");

console.log("\n[4/6] Verifica pagina e service worker");
const page = run(npxCommand, ["vercel", "curl", "/", "--deployment", deploymentUrl, "--", "--silent"]);
if (!page.includes('<div id="root"></div>')) throw new Error("La pagina del deployment non contiene l'app Workspace.");
const serviceWorker = run(npxCommand, ["vercel", "curl", "/sw.js", "--deployment", deploymentUrl, "--", "--silent"]);
if (!/precacheAndRoute|__WB_MANIFEST/.test(serviceWorker)) throw new Error("Service worker PWA non valido.");

console.log("\n[5/6] Promozione sui domini di produzione");
run(npxCommand, ["vercel", "promote", deploymentUrl, "--yes", "--timeout", "3m"], { allowCurrentProduction: true });

console.log(`\n[6/6] Verifica dominio operativo ${productionDomain}`);
const domainInspect = run(npxCommand, ["vercel", "inspect", `https://${productionDomain}`]);
const deploymentHost = new URL(deploymentUrl).hostname;
if (!domainInspect.includes(deploymentHost)) {
  throw new Error(`${productionDomain} non punta al deployment appena promosso.`);
}

console.log(`\nRilascio completato: https://${productionDomain}`);

