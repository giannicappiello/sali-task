import assert from "node:assert/strict";
import { agentCode, extractRows, isActiveAgent } from "../server/mexal/sync-agents.js";

assert.equal(agentCode({ codice_fornitore: " 602.00040 " }), "602.00040");
assert.equal(isActiveAgent({ codice: "602.00040", gest_annullato: "N" }), true);
assert.equal(isActiveAgent({ codice: "602.00040", gest_annullato: "S" }), false);
assert.equal(isActiveAgent({ codice: "501.00040", gest_annullato: "N" }), false);
assert.deepEqual(extractRows({ fornitori: [{ codice: "602.00040" }] }), [{ codice: "602.00040" }]);
