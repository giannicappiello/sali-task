import test from "node:test";
import assert from "node:assert/strict";
import {
  preparationDatabase,
  supabaseAdapter,
  mexalFixture,
  actor,
  event,
} from "./order-preparation-fixture.mjs";
import { createOrderPreparationHandler } from "../server/order-preparation-handler.js";
const { PGlite } = await import(process.env.PGLITE_MODULE);
async function fixture() {
  const sql = await preparationDatabase(PGlite),
    db = supabaseAdapter(sql),
    mexal = mexalFixture();
  let canWrite = true;
  const handler = createOrderPreparationHandler({
    authorize: async () => ({
      db,
      profile: { id: actor },
      canWrite,
      canConfigure: true,
    }),
    clientFactory: () => mexal,
  });
  const call = async (operation, body = {}) => {
    const res = {
      statusCode: 200,
      setHeader() {},
      status(n) {
        this.statusCode = n;
        return this;
      },
      json(data) {
        this.data = data;
        return this;
      },
    };
    await handler({ method: "POST", body: { operation, ...body } }, res);
    return res;
  };
  const begin = await call("begin", { reference: "OC+1+900" });
  assert.equal(begin.statusCode, 200, JSON.stringify(begin.data));
  const row = begin.data.preparation;
  return {
    sql,
    db,
    call,
    row,
    readOnly: () => {
      canWrite = false;
    },
    scan: (barcode = "000001") => ({
      id: row.id,
      version: row.version,
      eventId: event(),
      barcode,
      mode: "carton",
      packageId: row.state.packages[0].id,
    }),
  };
}
test("carton quantity comes only from the current specification, overrides and private data never leak", async () => {
  const f = await fixture();
  try {
    await f.sql.exec(
      "update warehouse_preparation_products set pieces_per_carton=999",
    );
    const settings = await f.call("settings");
    assert.equal(settings.data.products[0].pieces_per_carton, 2);
    assert.equal(settings.data.products[0].specification_version, 3);
    assert.ok(!JSON.stringify(settings.data).includes("private-not-exposed"));
    const response = await f.call("scan", { ...f.scan(), piecesPerCarton: 99 });
    assert.equal(response.statusCode, 200);
    assert.equal(response.data.scan.quantity, 2);
    assert.equal(
      response.data.preparation.state.scans[0].specificationVersion,
      3,
    );
    const configured = await f.call("configure_product", {
      code: "IT0001",
      barcode: "000001",
      piecesPerCarton: 99,
    });
    assert.equal(configured.statusCode, 400);
    assert.equal(
      (
        await f.sql.query(
          "select version from workspace_product_specifications",
        )
      ).rows[0].version,
      3,
    );
  } finally {
    await f.sql.close();
  }
});
test("missing carton quantity asks before scanning, fills the specification and preserves fields, attachments and audit history", async () => {
  const f = await fixture();
  try {
    await f.sql.exec(
      `update workspace_product_specifications set data='{"piecesPerBox":"","notes":"Keep notes","approvedBy":"Old approval","approvedAt":"2026-10-01","approvedUserId":"old"}',attachments='[{"id":"kept","path":"saved.pdf","section":"box"}]' where article_code='IT0001'`,
    );
    const scan = f.scan();
    let response = await f.call("scan", scan);
    assert.equal(response.statusCode, 200);
    assert.equal(response.data.requiresCartonPieces, true);
    assert.equal(
      (await f.call("get", { id: f.row.id })).data.preparation.state.scans
        .length,
      0,
    );
    response = await f.call("scan", { ...scan, piecesPerCarton: 3 });
    assert.equal(response.statusCode, 200, JSON.stringify(response.data));
    assert.equal(response.data.scan.quantity, 3);
    const saved = (
      await f.sql.query(
        "select * from workspace_product_specifications where article_code='IT0001'",
      )
    ).rows[0];
    assert.equal(saved.version, 4);
    assert.equal(saved.data.piecesPerBox, "3");
    assert.equal(saved.data.notes, "Keep notes");
    assert.equal(saved.data.approvedBy, undefined);
    assert.equal(saved.attachments[0].id, "kept");
    assert.equal(saved.updated_by, actor);
    assert.equal(
      (
        await f.sql.query(
          "select count(*)::int n from workspace_product_specification_revisions",
        )
      ).rows[0].n,
      1,
    );
    response = await f.call("scan", { ...scan, piecesPerCarton: 3 });
    assert.equal(response.data.preparation.state.scans.length, 1);
  } finally {
    await f.sql.close();
  }
});
test("missing specification is created; invalid, unauthorized and concurrent writes never corrupt it", async () => {
  const f = await fixture();
  try {
    const scan = f.scan("000002");
    let response = await f.call("scan", scan);
    assert.equal(response.data.requiresCartonPieces, true);
    for (const value of [0, -1, 1.5, "bad", 1000001]) {
      response = await f.call("scan", { ...scan, piecesPerCarton: value });
      assert.equal(response.statusCode, 400);
    }
    assert.equal(
      (
        await f.sql.query(
          "select count(*)::int n from workspace_product_specifications where article_code='IT0002'",
        )
      ).rows[0].n,
      0,
    );
    response = await f.call("scan", { ...scan, piecesPerCarton: 1 });
    assert.equal(response.statusCode, 200);
    assert.equal(
      response.data.preparation.state.scans[0].specificationVersion,
      1,
    );
    f.readOnly();
    response = await f.call("scan", {
      ...scan,
      eventId: event(),
      piecesPerCarton: 4,
    });
    assert.equal(response.statusCode, 403);
  } finally {
    await f.sql.close();
  }
  const g = await fixture();
  try {
    await g.sql.exec(
      "update workspace_product_specifications set data=data-'piecesPerBox'",
    );
    const rpc = g.db.rpc.bind(g.db);
    g.db.rpc = async (name, args) => {
      if (name === "save_workspace_product_specification")
        await g.sql.exec(
          'update workspace_product_specifications set version=version+1,data=data||\'{"notes":"Concurrent edit"}\'::jsonb',
        );
      return rpc(name, args);
    };
    const response = await g.call("scan", { ...g.scan(), piecesPerCarton: 6 });
    assert.equal(response.statusCode, 409);
    const saved = (
      await g.sql.query("select data from workspace_product_specifications")
    ).rows[0].data;
    assert.equal(saved.notes, "Concurrent edit");
    assert.equal(saved.piecesPerBox, undefined);
    assert.equal(
      (await g.call("get", { id: g.row.id })).data.preparation.state.scans
        .length,
      0,
    );
  } finally {
    await g.sql.close();
  }
});

test("QR URLs and manual IT codes resolve through the catalog, retain picking checks and never store URLs as barcodes", async () => {
 const f=await fixture(); let row=f.row;
 try {
  for (const value of ['it0001','https://prodotti.example/scheda/IT0001.html','https://prodotti.example/?codice=it0001','https://prodotti.example/?codice=%49%54%30%30%30%31']) {
   const input={...f.scan(value),version:row.version,mode:'piece'};
   const response=await f.call('scan',input); assert.equal(response.statusCode,200,JSON.stringify(response.data));
   row=response.data.preparation; assert.equal(response.data.scan.code,'IT0001');assert.equal(row.state.scans.at(-1).barcode,'IT0001');
   const replay=await f.call('scan',input);assert.equal(replay.data.preparation.state.scans.length,row.state.scans.length);
  }
  let response=await f.call('scan',{...f.scan('https://prodotti.example/?code=IT0001'),version:row.version});
  assert.equal(response.data.scan.quantity,2);row=response.data.preparation;
  response=await f.call('scan',{...f.scan('IT0003'),version:row.version,mode:'piece'});assert.equal(response.data.scan.wrong,true);row=response.data.preparation;
  for(const value of ['IT999999','https://example.test/IT0001/IT0002','x'.repeat(4097)]) {
   response=await f.call('scan',{...f.scan(value),version:row.version,mode:'piece'});assert.equal(response.statusCode,400);
  }
  await f.sql.exec("update ordini_prodotti_cache set ean='IT0001' where codice_articolo='IT0002'");
  response=await f.call('scan',{...f.scan('IT0001'),version:row.version,mode:'piece'});assert.equal(response.statusCode,400);
  f.readOnly();response=await f.call('scan',{...f.scan('IT0001'),version:row.version});assert.equal(response.statusCode,403);
 } finally {await f.sql.close();}
});
