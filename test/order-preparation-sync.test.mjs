import test from "node:test";
import assert from "node:assert/strict";
import {
  preparationDatabase,
  supabaseAdapter,
  mexalFixture,
} from "./order-preparation-fixture.mjs";
import {
  orderIndexWorkerToken,
  orderIndexWorkerAuthorized,
  synchronizeOrderIndex,
} from "../server/order-preparation-sync.js";
const { PGlite } = await import(process.env.PGLITE_MODULE);
test("scheduler authentication accepts only scoped HMAC, never the service key", () => {
  const secret = "test-secret",
    token = orderIndexWorkerToken(secret);
  assert.equal(
    orderIndexWorkerAuthorized(
      { headers: { authorization: "Bearer " + token } },
      secret,
    ),
    true,
  );
  for (const value of [secret, "", token.slice(1), "0".repeat(64)])
    assert.equal(
      orderIndexWorkerAuthorized(
        { headers: { authorization: "Bearer " + value } },
        secret,
      ),
      false,
    );
});
test("noon Rome scheduling observes summer/winter time, retries and one successful run per day", async () => {
  const sql = await preparationDatabase(PGlite);
  try {
    await sql.exec(
      "update warehouse_order_sync_cache set scheduler_enabled=true",
    );
    const tick = async (t) =>
      (await sql.query("select warehouse_tick_order_index_sync($1) id", [t]))
        .rows[0].id;
    assert.equal(await tick("2026-07-01T09:59:00Z"), null);
    assert.ok(await tick("2026-07-01T10:00:00Z"));
    assert.equal(await tick("2026-07-01T10:01:00Z"), null);
    assert.ok(await tick("2026-07-01T10:05:00Z"));
    for (const t of ["10:10", "10:15", "10:20"])
      assert.ok(await tick("2026-07-01T" + t + ":00Z"));
    assert.equal(await tick("2026-07-01T10:25:00Z"), null);
    assert.equal(await tick("2026-12-01T10:59:00Z"), null);
    assert.ok(await tick("2026-12-01T11:00:00Z"));
    await sql.exec(
      "update warehouse_order_sync_cache set last_scheduled_date='2026-12-01'",
    );
    assert.equal(await tick("2026-12-01T12:00:00Z"), null);
    for (const role of ["anon", "authenticated"]) {
      await sql.exec("set role " + role);
      await assert.rejects(
        sql.query("select * from warehouse_order_sync_cache"),
        /permission denied/,
      );
      await assert.rejects(
        sql.query("select warehouse_claim_order_index_sync($1)", ["manual"]),
        /permission denied/,
      );
      await sql.exec("reset role");
    }
  } finally {
    await sql.close();
  }
});
test("sync serializes requests, preserves last good orders on Mexal failure and rejects stale tokens", async () => {
  const sql = await preparationDatabase(PGlite),
    db = supabaseAdapter(sql),
    mexal = mexalFixture();
  try {
    const first = await synchronizeOrderIndex(db, mexal, "manual");
    assert.equal(first.orders.length, 1);
    const claim = (
      await db.rpc("warehouse_claim_order_index_sync", {
        p_source: "scheduled",
      })
    ).data;
    assert.ok(claim.token);
    assert.equal(
      (await db.rpc("warehouse_claim_order_index_sync", { p_source: "manual" }))
        .data,
      null,
    );
    assert.ok(
      (
        await db.rpc("warehouse_finish_order_index_sync", {
          p_token: null,
          p_orders: [],
          p_error: null,
        })
      ).error,
    );
    assert.ok(
      (
        await db.rpc("warehouse_finish_order_index_sync", {
          p_token: "22222222-2222-4222-8222-222222222222",
          p_orders: [],
          p_error: null,
        })
      ).error,
    );
    await db.rpc("warehouse_finish_order_index_sync", {
      p_token: claim.token,
      p_orders: null,
      p_error: "Timeout Mexal",
    });
    const failed = (
      await db
        .from("warehouse_order_sync_cache")
        .select("*")
        .eq("id", true)
        .single()
    ).data;
    assert.deepEqual(failed.orders, first.orders);
    assert.equal(new Date(failed.last_synced_at).getTime(), new Date(first.last_synced_at).getTime());
    assert.equal(failed.last_error, "Timeout Mexal");
    assert.equal(failed.last_scheduled_date, null);
    const final = await synchronizeOrderIndex(db, mexal, "scheduled");
    assert.equal(final.last_error, null);
    assert.ok(final.last_scheduled_date);
  } finally {
    await sql.close();
  }
});

test('list reads the saved index, manual refresh updates it, timeout retains last valid list',async()=>{
 const {createOrderPreparationHandler}=await import('../server/order-preparation-handler.js');
 const sql=await preparationDatabase(PGlite),db=supabaseAdapter(sql),mexal=mexalFixture();let reads=0,fail=false;
 const original=mexal.postJson.bind(mexal);mexal.postJson=async(...args)=>{reads++;if(fail)throw new Error('Mexal timeout');return original(...args);};
 const handler=createOrderPreparationHandler({authorize:async()=>({db,profile:{id:'11111111-1111-4111-8111-111111111111'},canWrite:true}),clientFactory:()=>mexal});
 async function list(refresh=false){const res={statusCode:200,setHeader(){},status(n){this.statusCode=n;return this;},json(data){this.data=data;return this;}};await handler({method:'POST',body:{operation:'list',refresh}},res);assert.equal(res.statusCode,200);return res.data;}
 try{assert.equal((await list()).orders.length,1);const before=reads;await list();assert.equal(reads,before);await list(true);assert.ok(reads>before);fail=true;const saved=await list(true);assert.equal(saved.orders.length,1);assert.equal(saved.sync.lastError,'Mexal timeout');}finally{await sql.close();}
});
