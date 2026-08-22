import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

const roots = ["src", "dist"];
const forbiddenMarkers = ["PROGREMES_INTEGRATION_SECRET", "X-Workspace-Secret"];
const configuredSecret = String(process.env.PROGREMES_INTEGRATION_SECRET || "");
const failures = [];

async function filesUnder(root) {
  try {
    const entries = await readdir(root, { withFileTypes: true });
    const nested = await Promise.all(entries.map(async (entry) => {
      const target = path.join(root, entry.name);
      return entry.isDirectory() ? filesUnder(target) : [target];
    }));
    return nested.flat();
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

for (const root of roots) {
  for (const file of await filesUnder(root)) {
    const details = await stat(file);
    if (!details.isFile() || details.size > 10 * 1024 * 1024) continue;
    const content = await readFile(file, "utf8").catch(() => "");
    if (forbiddenMarkers.some((marker) => content.includes(marker))) failures.push(file);
    if (configuredSecret.length >= 8 && content.includes(configuredSecret)) failures.push(file);
  }
}

if (failures.length) {
  console.error(`Confine secret ProgreMES violato in ${[...new Set(failures)].join(", ")}`);
  process.exit(1);
}

console.log("Confine secret ProgreMES verificato: nessun marker o valore nel frontend/bundle.");
