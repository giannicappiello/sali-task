import assert from "node:assert/strict";
import { reconciliationFailure } from "../server/mexal/order-documents.js";

assert.equal(reconciliationFailure(null, "M", { cod_modulo: "M" }), null, "valid document is reconciled");
assert.deepEqual(reconciliationFailure({ status: 401, message: "unauthorized" }, "M"), { stato: "auth_error", errore: "unauthorized" });
assert.deepEqual(reconciliationFailure({ message: "Timeout collegamento Mexal." }, "M"), { stato: "temporary_error", errore: "Timeout collegamento Mexal." });
assert.deepEqual(reconciliationFailure({ status: 404, message: "not found" }, "M"), { stato: "missing", errore: "not found" });
assert.deepEqual(reconciliationFailure(null, "M", { cod_modulo: "X" }), { stato: "mismatch", errore: "cod_modulo Mexal X." });

const source = await (await import("node:fs/promises")).readFile("api/mexal/submit-order.js", "utf8");
assert.match(source, /if \(savedDocument\?\.numero \|\| done\.has\(kind\)\)[\s\S]*getJson[\s\S]*continue;/, "a numbered document reconciles and exits before POST");
console.log("mexal order reconciliation: success, auth, timeout, missing, mismatch, and no duplicate POST verified");
