import assert from "node:assert/strict";
import test from "node:test";
import { agentDisplayName, customerDisplayName } from "../../src/modules/orders/services/orderPartyNames.js";

test("il cliente usa l'anagrafica sincronizzata quando la testata contiene soltanto il codice", () => {
  const names = new Map([["501.01044", "Cliente Completo Srl"]]);
  assert.equal(customerDisplayName({ codice_cliente: "501.01044", ragione_sociale_cliente: "501.01044" }, names), "Cliente Completo Srl");
});

test("l'agente mancante sulla testata viene risolto tramite il cliente", () => {
  const agents = new Map([["602.00057", "Cappiello Giovanni"]]);
  const customerAgents = new Map([["501.01044", "602.00057"]]);
  assert.equal(agentDisplayName({ codice_cliente: "501.01044" }, agents, customerAgents), "Cappiello Giovanni");
});

test("il codice resta visibile solo come fallback diagnostico se l'anagrafica manca", () => {
  assert.equal(agentDisplayName({ codice_agente_mexal: "602.99999" }), "602.99999");
  assert.equal(customerDisplayName({ codice_cliente: "501.99999" }), "501.99999");
});
