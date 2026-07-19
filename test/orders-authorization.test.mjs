import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { verifyUser } from "../server/mexal/sync-products.js";

function createSupabase({ user = { id: "auth-1" }, authError = null, profiles = [], integrations = [] } = {}) {
  let table = "";
  const query = {
    select() { return this; },
    eq() { return this; },
    limit() {
      if (table === "utenti") return Promise.resolve({ data: profiles, error: null });
      return Promise.resolve({ data: integrations, error: null });
    },
  };
  return {
    auth: { getUser: async () => ({ data: { user }, error: authError }) },
    from(name) { table = name; return query; },
  };
}

const req = { headers: { authorization: "Bearer valid-token" } };
const profile = (overrides = {}) => ({ id: "profile-1", attivo: true, ruoli: { nome: "Operatore", livello: 10 }, ...overrides });
const access = (ruolo_ordini) => [{ enabled: true, ruolo_ordini }];

await assert.doesNotReject(() => verifyUser(req, createSupabase({ profiles: [profile({ ruoli: { nome: "Admin", livello: 100 } })] }), { allowOrdersUser: true }), "admin autorizzato");
await assert.doesNotReject(() => verifyUser(req, createSupabase({ profiles: [profile()], integrations: access("backoffice") }), { allowOrdersUser: true }), "backoffice autorizzato");
await assert.doesNotReject(() => verifyUser(req, createSupabase({ profiles: [profile()], integrations: access("agente") }), { allowOrdersUser: true }), "agente autorizzato");
await assert.rejects(() => verifyUser(req, createSupabase({ profiles: [profile()], integrations: [{ enabled: false, ruolo_ordini: "agente" }] }), { allowOrdersUser: true }), { status: 403 });
await assert.rejects(() => verifyUser(req, createSupabase({ profiles: [profile({ attivo: false })] }), { allowOrdersUser: true }), { status: 403 });
await assert.rejects(() => verifyUser(req, createSupabase(), { allowOrdersUser: true }), { status: 403 });
await assert.rejects(() => verifyUser(req, createSupabase({ profiles: [profile(), profile({ id: "profile-2" })] }), { allowOrdersUser: true }), { status: 409 });
await assert.rejects(() => verifyUser(req, createSupabase({ authError: new Error("bad token"), user: null }), { allowOrdersUser: true }), { status: 401 });

const submit = await readFile("api/mexal/submit-order.js", "utf8");
const availability = await readFile("api/mexal/orders/check-availability.js", "utf8");
assert.match(submit, /verifyUser\(req, admin, \{ allowOrdersUser: true \}\)/, "submit condivide l'helper Ordini");
assert.match(availability, /verifyUser\(req, supabase, \{ allowOrdersUser: true \}\)/, "availability usa lo stesso helper Ordini");
assert.doesNotMatch(submit, /function verifyUser/, "submit non mantiene una verifica duplicata");

const detail = await readFile("src/modules/orders/pages/OrderDetail.jsx", "utf8");
assert.match(detail, /setError\(sendError\.message/, "l'errore API viene mostrato nella pagina");
assert.match(detail, /disabled=\{sending \|\| syncStatus === "in_corso" \|\| syncStatus === "completato"\}/, "invio disabilitato durante la richiesta");
assert.match(detail, /numero_ocm: result\.numero_ocm/, "successo aggiorna OCM senza refresh");
assert.match(detail, /numero_ocx: result\.numero_ocx/, "successo aggiorna OCX senza refresh");
assert.doesNotMatch(detail, /catch \(sendError\)[\s\S]{0,180}await load\(\)/, "errore non ricarica semplicemente il dettaglio");
console.log("orders authorization: centralized decisions and UI submit behaviour verified");
