import assert from "node:assert/strict";
import test from "node:test";
import { readAllProgremesArticleSupplierHistory, readAllProgremesSuppliers } from "./progremes-readonly-client.js";

test("carica tutti i fornitori ProgreMES oltre la prima pagina", async () => {
  const calls = [];
  const client = {
    async request(resource, query) {
      calls.push({ resource, query });
      if (query.page === 1) return { page: 1, pageSize: 500, total: 501, items: [{ id: 1 }] };
      return { page: 2, pageSize: 500, total: 501, items: [{ id: 501 }] };
    },
  };
  const suppliers = await readAllProgremesSuppliers(client);
  assert.deepEqual(suppliers.map((item) => item.id), [1, 501]);
  assert.deepEqual(calls.map((call) => call.query.page), [1, 2]);
  assert.ok(calls.every((call) => call.resource === "suppliers" && call.query.active === true));
});

test("carica tutto lo storico articolo-fornitore oltre la prima pagina", async () => {
  const calls = [];
  const client = {
    async request(resource, query) {
      calls.push({ resource, query });
      if (query.page === 1) return { page: 1, pageSize: 500, total: 501, items: [{ articleId: 1 }] };
      return { page: 2, pageSize: 500, total: 501, items: [{ articleId: 501 }] };
    },
  };
  const history = await readAllProgremesArticleSupplierHistory(client);
  assert.deepEqual(history.map((item) => item.articleId), [1, 501]);
  assert.deepEqual(calls.map((call) => call.query.page), [1, 2]);
  assert.ok(calls.every((call) => call.resource === "article-supplier-history" && call.query.active === true));
});
