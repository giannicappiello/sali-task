import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../src/styles/settings-menu-groups.css", import.meta.url), "utf8");

assert.match(css, /grid-template-columns:\s*repeat\(2,/);
assert.match(css, /button:nth-child\(5\).*grid-column:\s*1\s*\/\s*-1/s);
assert.match(css, /content:\s*"TEAM"/);
assert.match(css, /content:\s*"REPARTI \/ RUOLI"/);
assert.match(css, /content:\s*"VOCI DI PROGETTO"/);
assert.doesNotMatch(css, /font-size:\s*0/);

console.log("settings menu: card allineate e gruppi verificati");
