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
    mexal,
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
  const f = await fixture();
  let row = f.row;
  try {
    for (const value of [
      "it0001",
      "https://prodotti.example/scheda/IT0001.html",
      "https://prodotti.example/?codice=it0001",
      "https://prodotti.example/?codice=%49%54%30%30%30%31",
    ]) {
      const input = { ...f.scan(value), version: row.version, mode: "piece" };
      const response = await f.call("scan", input);
      assert.equal(response.statusCode, 200, JSON.stringify(response.data));
      row = response.data.preparation;
      assert.equal(response.data.scan.code, "IT0001");
      assert.equal(row.state.scans.at(-1).barcode, "IT0001");
      const replay = await f.call("scan", input);
      assert.equal(
        replay.data.preparation.state.scans.length,
        row.state.scans.length,
      );
    }
    let response = await f.call("scan", {
      ...f.scan("https://prodotti.example/?code=IT0001"),
      version: row.version,
    });
    assert.equal(response.data.scan.quantity, 2);
    row = response.data.preparation;
    response = await f.call("scan", {
      ...f.scan("IT0003"),
      version: row.version,
      mode: "piece",
    });
    assert.equal(response.data.scan.wrong, true);
    row = response.data.preparation;
    for (const value of [
      "IT999999",
      "https://example.test/IT0001/IT0002",
      "x".repeat(4097),
    ]) {
      response = await f.call("scan", {
        ...f.scan(value),
        version: row.version,
        mode: "piece",
      });
      assert.equal(response.statusCode, 400);
    }
    await f.sql.exec(
      "update ordini_prodotti_cache set ean='IT0001' where codice_articolo='IT0002'",
    );
    response = await f.call("scan", {
      ...f.scan("IT0001"),
      version: row.version,
      mode: "piece",
    });
    assert.equal(response.statusCode, 400);
    f.readOnly();
    response = await f.call("scan", {
      ...f.scan("IT0001"),
      version: row.version,
    });
    assert.equal(response.statusCode, 403);
  } finally {
    await f.sql.close();
  }
});

test("pallet picking assigns existing packages and creates a new carton only with its first confirmed scan, atomically and idempotently", async () => {
  const f = await fixture();
  try {
    const palletId = event();
    let response = await f.call("add_pallet", {
      id: f.row.id,
      version: f.row.version,
      eventId: event(),
      palletId,
      assignUnassigned: true,
    });
    assert.equal(response.statusCode, 200, JSON.stringify(response.data));
    let row = response.data.preparation;
    assert.equal(row.state.packages[0].palletId, palletId);
    response = await f.call("scan", {
      id: row.id,
      version: row.version,
      eventId: event(),
      barcode: "000001",
      mode: "carton",
      packageId: row.state.packages[0].id,
    });
    assert.equal(response.statusCode, 200, JSON.stringify(response.data));
    row = response.data.preparation;
    assert.equal(row.state.packages.length, 1);
    assert.equal(row.state.scans.length, 1);
    assert.equal(row.state.scans[0].quantity, 2);
    // A virtual next package must not create an empty packing-list entry.
    assert.equal(
      row.state.packages.filter(
        (p) => !row.state.scans.some((s) => s.packageId === p.id),
      ).length,
      0,
    );
    const nextId = event(),
      body = {
        id: row.id,
        version: row.version,
        eventId: event(),
        barcode: "000002",
        mode: "piece",
        packageId: nextId,
        createPackage: true,
        palletId,
      };
    response = await f.call("scan", body);
    assert.equal(response.statusCode, 200, JSON.stringify(response.data));
    row = response.data.preparation;
    assert.equal(row.state.packages.length, 2);
    assert.equal(row.state.packages[1].palletId, palletId);
    assert.equal(row.state.packages[1].number, 2);
    response = await f.call("scan", body);
    assert.equal(response.statusCode, 200);
    assert.equal(response.data.preparation.state.packages.length, 2);
    assert.equal(response.data.preparation.state.scans.length, 2);
    const invalid = await f.call("scan", {
      ...body,
      version: row.version,
      eventId: event(),
      packageId: event(),
      palletId: event(),
    });
    assert.equal(invalid.statusCode, 400);
    const state = await f.call("get", { id: row.id });
    assert.equal(state.data.preparation.state.packages.length, 2);
  } finally {
    await f.sql.close();
  }
});

test("FIFO proposal uses today's date, refreshes stale warnings and product lookup never records a scan",async()=>{
 const f=await fixture();try{
  assert.ok(f.row.source.fifoProposal?.length,JSON.stringify(f.row.source));assert.equal(f.row.source.fifoIssue,undefined);
  const before=await f.call("get",{id:f.row.id});
  const resolved=await f.call("resolve_product",{id:f.row.id,barcode:"000001"});assert.equal(resolved.statusCode,200,JSON.stringify(resolved.data));assert.equal(resolved.data.product.code,"IT0001");assert.equal(resolved.data.product.description,"Primo prodotto");
  assert.equal(resolved.data.product.piecesPerCarton,2);
  const after=await f.call("get",{id:f.row.id});assert.equal(after.data.preparation.version,before.data.preparation.version);assert.equal(after.data.preparation.state.scans.length,0);
  await f.sql.query("update warehouse_order_preparations set source=source || $1::jsonb where id=$2",[JSON.stringify({fifoIssue:"Lotti FIFO insufficienti",fifoProposal:[]}),f.row.id]);
  const refreshed=await f.call("get",{id:f.row.id});assert.equal(refreshed.data.preparation.source.fifoIssue,undefined);assert.ok(refreshed.data.preparation.source.fifoProposal.length);
  assert.equal((await f.call("resolve_product",{id:f.row.id,barcode:"UNKNOWN"})).statusCode,400);
  f.readOnly();assert.equal((await f.call("resolve_product",{id:f.row.id,barcode:"IT0001"})).statusCode,200);
 }finally{await f.sql.close();}
});


test("verify, cancel and reopen refresh historical FIFO errors without reserving on reopen; real shortages still block",async()=>{
  const f=await fixture();
  try {
    let row=f.row;
    for(const [barcode,mode] of [["000001","carton"],["000002","piece"]]) {
      const r=await f.call("scan",{...f.scan(barcode),version:row.version,mode});
      assert.equal(r.statusCode,200,JSON.stringify(r.data)); row=r.data.preparation;
    }
    await f.sql.query("update warehouse_order_preparations set source=source || $1::jsonb where id=$2",[JSON.stringify({fifoIssue:"Lotti FIFO insufficienti",fifoProposal:[]}),row.id]);
    const action=async (operation,eventId=event())=>{
      const r=await f.call(operation,{id:row.id,version:row.version,eventId});
      assert.equal(r.statusCode,200,JSON.stringify(r.data));row=r.data.preparation;return r;
    };
    await action("verify");
    assert.equal(row.status,"verified");assert.equal(row.source.fifoIssue,undefined);
    assert.equal((await f.call("get",{id:row.id})).data.preparation.source.fifoIssue,undefined);
    await action("cancel");
    const reopenEvent=event();await action("reopen",reopenEvent);
    const replay=await f.call("reopen",{id:row.id,version:row.version-1,eventId:reopenEvent});
    assert.equal(replay.statusCode,200);assert.equal(replay.data.preparation.source.fifoIssue,undefined);
    assert.equal(replay.data.preparation.version,row.version);
    assert.equal(row.status,"draft");assert.equal(row.source.fifoIssue,undefined);assert.ok(row.source.fifoProposal.length);
    assert.equal((await f.sql.query("select count(*)::int n from warehouse_preparation_lot_holds")).rows[0].n,0);
    await action("verify");assert.equal(row.status,"verified");
    await action("cancel");
    // A reopened preparation must also refresh a previously successful proposal.
    await f.sql.query("update warehouse_order_preparations set source=source - 'fifoIssue' where id=$1",[row.id]);
    const getJson=f.mexal.getJson.bind(f.mexal);
    f.mexal.getJson=async path=>{
      const p=await getJson(path);
      return path.startsWith("/progressivi-articoli")?{...p,qta_inventario:[],qta_carico:[],qta_scarico:[]}:p;
    };
    await action("reopen");assert.match(row.source.fifoIssue,/FIFO insufficienti/);
    const shortage=await f.call("verify",{id:row.id,version:row.version,eventId:event()});
    assert.equal(shortage.statusCode,409);assert.match(shortage.data.error,/FIFO insufficienti/);
  } finally {await f.sql.close();}
});
