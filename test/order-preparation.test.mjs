/* global process */
import test from "node:test";
import assert from "node:assert/strict";
import {
  eligibleOrder,
  orderRows,
  initialPacking,
  comparePacking,
  allocateFifo,
  distributeLots,
  packingSummary,
} from "../shared/orderPreparation.js";
import {
  buildDdt,
  verifyDdt,
  loadOrderContext,
  pages,
} from "../server/order-preparation-mexal.js";
import { createOrderPreparationHandler } from "../server/order-preparation-handler.js";
import {
  preparationDatabase,
  supabaseAdapter,
  mexalFixture,
  actor,
  event,
} from "./order-preparation-fixture.mjs";
const line = (quantity = 2) => ({
  code: "IT0001",
  position: 2,
  id: 21,
  warehouse: 5,
  quantity,
  lotRequired: true,
  physical: 100,
});
const lot = (id, quantity, date = "20260101", warehouse = 5) => ({
  code: "IT0001",
  warehouse,
  lotId: id,
  lotCode: "L" + id,
  quantity,
  entryDate: date,
});
function scan(
  state,
  code = "IT0001",
  quantity = 1,
  mode = "piece",
  packageId = state.packages[0].id,
) {
  state.scans.push({
    id: event(),
    packageId,
    code,
    quantity,
    mode,
    barcode: "000001",
  });
  return state;
}

test("OCM eligibility normalizes case and spaces without including other modules", () => {
  const raw = mexalFixture().raw;
  assert(eligibleOrder({ ...raw, nota: [[1, "nota CONSEGNATO  MGZ fine"]] }));
  for (const values of [
    { sigla: "BC" },
    { cod_modulo: "X" },
    { nota: [[1, "nonconsegnato mgz"]] },
    { nota: [[1, "consegnato mgzz"]] },
  ])
    assert(!eligibleOrder({ ...raw, ...values }));
  assert.deepEqual(
    orderRows(raw).map((r) => [
      r.position,
      r.id,
      r.type,
      r.status,
      r.warehouse,
    ]),
    [
      [2, 22, "R", "E", 5],
      [3, 23, "R", "E", 5],
    ],
  );
});
test("riscontro aggregates duplicate order rows and distinguishes missing, extra, wrong products", () => {
  const state = initialPacking();
  scan(state);
  let c = comparePacking([line(1), line(2)], state);
  assert.equal(c.discrepancies[0].missing, 2);
  scan(state, "IT0001", 3, "carton");
  scan(state, "IT0003");
  c = comparePacking([line(3)], state);
  assert.equal(c.discrepancies.find((d) => d.code === "IT0001").extra, 1);
  assert.equal(c.discrepancies.find((d) => d.code === "IT0003").kind, "wrong");
  assert.throws(
    () => comparePacking([line()], scan(initialPacking(), "IT0001", 3)),
    /un pezzo/,
  );
});
test("packaging rejects empty cartons, empty pallets and unassigned cartons", () => {
  const state = scan(initialPacking(), "IT0001", 2, "carton");
  state.pallets.push({ id: event(), number: 1 });
  assert(!comparePacking([line()], state).ok);
  state.packages[0].palletId = state.pallets[0].id;
  assert(comparePacking([line()], state).ok);
  state.packages.push({
    id: event(),
    number: 2,
    palletId: state.pallets[0].id,
  });
  assert.match(comparePacking([line()], state).packagingErrors[0], /vuoto/);
});
test("FIFO consumes only same warehouse, eligible dates and available non-reserved stock across repeated rows", () => {
  assert.throws(()=>allocateFifo([line(1)],[lot(1,8)]),/Data di riferimento FIFO/);
  const allocations = allocateFifo(
    [line(3), { ...line(2), position: 3 }],
    [
      lot(2, 8, "20260201"),
      lot(1, 4),
      lot(3, 99, "20260101", 4),
      lot(4, 99, "20280101"),
      { ...lot(5, 99), expiry: "20250101" },
    ],
    [{ code: "IT0001", warehouse: 5, lotId: 1, quantity: 2 }],
    "20261030",
  );
  assert.deepEqual(
    allocations.map((a) => [a.position, a.lotId, a.quantity]),
    [
      [2, 1, 2],
      [2, 2, 1],
      [3, 2, 2],
    ],
  );
  assert.throws(
    () => allocateFifo([line(9)], [lot(1, 8)], [], "20261030"),
    /insufficienti/,
  );
});
test("packing list preserves each carton contents, pieces and cartons per pallet", () => {
  const state = initialPacking(),
    b = { id: event(), number: 1 };
  state.pallets.push(b);
  state.packages[0].palletId = b.id;
  scan(state, "IT0001", 2, "carton");
  state.packages.push({ id: event(), number: 2, palletId: b.id });
  scan(state, "IT0001", 1, "piece", state.packages[1].id);
  const allocation = allocateFifo(
    [line(3)],
    [lot(1, 2), lot(2, 1, "20260201")],
    [],
    "20261030",
  );
  const summary = packingSummary(state, distributeLots(state, allocation), [
    line(3),
  ]);
  assert.equal(summary.totalPieces, 3);
  assert.equal(summary.totalPackages, 2);
  assert.equal(summary.totalPallets, 1);
  assert.equal(summary.pallets[0].cartons, 2);
  assert.deepEqual(
    summary.packages.map((p) => [p.pieces, p.contents[0].lotId]),
    [
      [2, 1],
      [1, 2],
    ],
  );
});
test("Mexal pagination rejects a repeated cursor", async () => {
  await assert.rejects(
    pages({ getJson: async () => ({ dati: [], next: "same" }) }, "/test"),
    /ripetuta/,
  );
});
test("DDT retains all source row references and rejects extra products, incorrect origin and lots", () => {
  const f = mexalFixture(),
    source = {
      series: 1,
      number: 900,
      date: f.raw.data_documento,
      customerCode: f.raw.cod_conto,
      lines: orderRows(f.raw).map((r) => ({ ...r, lotRequired: true })),
    };
  const prep = { id: event(), source, state: initialPacking() };
  const allocations = source.lines.map((r, i) => ({
    ...r,
    lotId: i + 51,
    quantity: r.quantity,
  }));
  const payload = buildDdt(
    prep,
    { source, raw: f.raw },
    allocations,
    { ddt_series: 1 },
    "20261030",
  );
  assert.deepEqual(payload.id_riga_orig, [
    [1, 21],
    [2, 22],
    [3, 23],
  ]);
  assert.deepEqual(payload.sigla_doc_orig, [[1, "OC"]]);
  assert.deepEqual(payload.quantita, f.raw.quantita);
  assert.deepEqual(payload.id_mag_da_riga, f.raw.id_mag_riga);
  const actual = { ...structuredClone(payload), numero: 123 };
  assert.equal(verifyDdt(actual, prep, payload).number, 123);
  const extra = structuredClone(actual);
  extra.codice_articolo.push([4, "IT0003"]);
  extra.quantita.push([4, 1]);
  assert.throws(() => verifyDdt(extra, prep, payload), /Quantità/);
  assert.throws(
    () => verifyDdt({ ...actual, numero_doc_orig: [[1, 999]] }, prep, payload),
    /collegamento/,
  );
  assert.throws(
    () =>
      verifyDdt(
        {
          ...actual,
          id_lotto: [
            [1, 99],
            [2, 52],
          ],
        },
        prep,
        payload,
      ),
    /Lotti/,
  );
  assert.throws(()=>verifyDdt({...actual,id_mag_riga:[[2,4],[3,5]]},prep,payload),/magazzino/);
  const equalPrep=structuredClone(prep),equalRaw=structuredClone(f.raw);
  equalPrep.source.lines[1].quantity=2;equalRaw.quantita[1][1]=2;
  const equalPayload=buildDdt(equalPrep,{source:equalPrep.source,raw:equalRaw},equalPrep.source.lines.map((row,i)=>({...row,lotId:i+51})),{ddt_series:1},'20261030');
  assert.throws(()=>verifyDdt({...equalPayload,numero:123,id_lotto:[[1,52],[2,51]]},equalPrep,equalPayload),/Lotti/);
});

test(
  "database and API: persistence, permissions, CAS, scan replay, FIFO holds and uncertain DDT reconciliation",
  { skip: !process.env.PGLITE_MODULE },
  async () => {
    const { PGlite } = await import(process.env.PGLITE_MODULE),
      sql = await preparationDatabase(PGlite);
    try {
      const db = supabaseAdapter(sql),
        mexal = mexalFixture();
      let canWrite = true;
      const handler = createOrderPreparationHandler({
        authorize: async () => ({
          db,
          profile: { id: actor },
          canWrite,
          canConfigure: false,
        }),
        clientFactory: () => mexal,
      });
      const call = async (operation, body = {}) => {
        const response = {
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
        await handler(
          { method: "POST", body: { operation, ...body } },
          response,
        );
        return response;
      };
      let response = await call("list");
      assert.equal(response.statusCode, 200, JSON.stringify(response.data));
      assert.equal(response.data.orders.length, 1);
      response = await call("begin", { reference: "OC+1+900" });
      assert.equal(response.statusCode, 200, JSON.stringify(response.data));
      let row = response.data.preparation;
      assert.equal(row.source.fifoProposal.length, 2);
      const id = row.id;
      assert.equal(
        (await call("begin", { reference: "OC+1+900" })).data.preparation.id,
        id,
      );
      const original = {
        id,
        version: row.version,
        eventId: event(),
        barcode: "000001",
        packageId: row.state.packages[0].id,
        mode: "carton",
      };
      response = await call("scan", original);
      assert.equal(response.statusCode, 200, JSON.stringify(response.data));
      row = response.data.preparation;
      assert.equal(row.state.scans[0].quantity, 2);
      response = await call("scan", original);
      assert.equal(
        response.data.preparation.state.scans.length,
        1,
        "retry must not duplicate carton",
      );
      assert.equal(
        (await call("scan", { ...original, eventId: event() })).statusCode,
        409,
        "stale second device cannot overwrite",
      );
      canWrite = false;
      assert.equal(
        (
          await call("scan", {
            ...original,
            version: row.version,
            eventId: event(),
          })
        ).statusCode,
        403,
      );
      assert.equal((await call("get", { id })).statusCode, 200);
      canWrite = true;
      assert.equal(
        (await call("configure", { warehouse: 5, ddtSeries: 1 })).statusCode,
        403,
      );
      response = await call("verify", {
        id,
        version: row.version,
        eventId: event(),
      });
      assert.equal(response.data.verification.ok, false);
      assert.equal(mexal.sends, 0);
      response = await call("scan", {
        ...original,
        barcode: "000002",
        mode: "piece",
        version: row.version,
        eventId: event(),
      });
      row = response.data.preparation;
      response = await call("verify", {
        id,
        version: row.version,
        eventId: event(),
      });
      assert.equal(response.statusCode, 200, JSON.stringify(response.data));
      row = response.data.preparation;
      assert.equal(row.status, "verified");
      assert.equal(
        (
          await sql.query(
            "select count(*)::int n from warehouse_preparation_lot_holds",
          )
        ).rows[0].n,
        2,
      );
      mexal.timeout = true;
      response = await call("export", {
        id,
        version: row.version,
        eventId: event(),
        confirmedLots: true,
        ddtNotes: "consegnato al mgz | Scaricare sul retro",
      });
      assert.equal(response.statusCode, 202, JSON.stringify(response.data));
      row = response.data.preparation;
      assert.equal(row.status, "uncertain");
      assert.equal(mexal.sends, 1);
      assert.equal(mexal.ddt.cod_modulo, "S");
      assert.deepEqual(mexal.ddt.id_causale, [[1, 1]]);
      assert.ok(mexal.ddt.nota[0][1].startsWith("Scaricare sul retro | ALL:"));
      assert.ok(!/consegnato/i.test(mexal.ddt.nota[0][1]));
      assert.deepEqual((await sql.query("select export_payload from warehouse_order_preparations where id=$1", [id])).rows[0].export_payload.nota, mexal.ddt.nota);
      assert.equal(
        (
          await call("export", {
            id,
            version: row.version,
            eventId: event(),
            confirmedLots: true,
          })
        ).statusCode,
        409,
      );
      assert.equal(mexal.sends, 1);
      response = await call("reconcile", {
        id,
        version: row.version,
        eventId: event(),
      });
      assert.equal(response.statusCode, 200, JSON.stringify(response.data));
      row = response.data.preparation;
      assert.equal(row.status, "completed");
      assert.equal(row.ddt.number, 123);
      assert.equal(mexal.sends, 1);
      assert.equal(
        (
          await sql.query(
            "select count(*)::int n from warehouse_preparation_lot_holds",
          )
        ).rows[0].n,
        0,
      );
      mexal.anno = "2027";
      assert.equal(
        (await call("get", { id })).statusCode,
        200,
        "historical packing list remains readable",
      );
      const areas = (
        await sql.query(
          "select aree from workspace_moduli where codice='magazzino'",
        )
      ).rows[0].aree;
      assert(areas.includes("produzione") && areas.includes("logistica"));
      await sql.exec("set role authenticated");
      await assert.rejects(
        sql.query("select * from warehouse_order_preparations"),
        /permission denied/,
      );
      await assert.rejects(
        sql.query("select warehouse_preparation_mutate(null,0,$1,$2,$3,$4)", [
          event(),
          actor,
          "create",
          {},
        ]),
        /permission denied/,
      );
      await sql.exec("reset role");
    } finally {
      await sql.close();
    }
  },
);

test(
  "database: concurrent reservations are rejected and cancelling releases a lot",
  { skip: !process.env.PGLITE_MODULE },
  async () => {
    const { PGlite } = await import(process.env.PGLITE_MODULE),
      sql = await preparationDatabase(PGlite);
    const db = supabaseAdapter(sql);
    const mutate = async (row, action, data = {}, eventId = event()) => {
      const r = await db.rpc("warehouse_preparation_mutate", {
        p_id: row?.id,
        p_version: row?.version || 0,
        p_event: eventId,
        p_actor: actor,
        p_action: action,
        p_data: data,
      });
      if (r.error) throw r.error;
      return r.data;
    };
    try {
      const create = (key) =>
        mutate(null, "create", {
          source_key: key,
          source: {},
          source_raw: {},
          source_hash: "hash",
          state: initialPacking(),
        });
      let a = await create("first"),
        b = await create("second");
      const verification = {
        verification: { ok: true },
        holds: [
          {
            code: "IT0001",
            warehouse: 5,
            lot_id: 51,
            quantity: 6,
            capacity: 10,
          },
        ],
      };
      a = await mutate(a, "verify", verification);
      await assert.rejects(mutate(b, "verify", verification), /riservato/);
      a = await mutate(a, "cancel");
      b = await mutate(b, "verify", verification);
      assert.equal(b.status, "verified");
      a = await mutate(a, "reopen");
      assert.equal(a.status, "draft");
      await assert.rejects(
        mutate(a, "claim_export", {
          confirmedLots: true,
          source_hash: "hash",
          payload: {},
        }),
        /Riscontro/,
      );
      const token = event();
      b = await mutate(
        b,
        "claim_export",
        { confirmedLots: true, source_hash: "hash", payload: {} },
        token,
      );
      await assert.rejects(
        mutate(
          b,
          "claim_export",
          { confirmedLots: true, source_hash: "hash", payload: {} },
          token,
        ),
        /Invio già acquisito/,
      );
    } finally {
      await sql.close();
    }
  },
);

test("BCS preserves sale reason, cleans handoff notes and verifies the exact confirmed notes", async () => {
 const { cleanWarehouseHandoffNote, eligibleOrder } = await import('../shared/orderPreparation.js');
 assert.equal(cleanWarehouseHandoffNote('CONSEGNATO AL MGZ | Consegnare al piano'), 'Consegnare al piano');
 assert.equal(cleanWarehouseHandoffNote([[1,'Prima nota'],[2,'consegnato mgz'],[3,'Ultima nota']]), 'Prima nota\n\nUltima nota');
 assert.ok(eligibleOrder({sigla:'OC',cod_modulo:'M',nota:[[1,'altra nota'],[2,'consegnato al mgz']]}));
 const f=mexalFixture(),source={series:1,number:900,date:f.raw.data_documento,customerCode:f.raw.cod_conto,lines:orderRows(f.raw).map(r=>({...r,lotRequired:true}))};
 const prep={id:event(),source,state:initialPacking()},allocations=source.lines.map((r,i)=>({...r,lotId:i+51,quantity:r.quantity}));
 const payload=buildDdt(prep,{source,raw:f.raw},allocations,{ddt_series:1},'20261031','Nuove note: suonare al cancello.');
 assert.equal(payload.cod_modulo,'S');assert.deepEqual(payload.id_causale,f.raw.id_causale);
 assert.equal(payload.nota[0][1],`Nuove note: suonare al cancello. | ALL:${prep.id}`);
 const actual={...structuredClone(payload),numero:123};assert.equal(verifyDdt(actual,prep,payload).signature,'BCS');
 assert.throws(()=>verifyDdt({...actual,cod_modulo:''},prep,payload),/non corrispondente/);
 assert.throws(()=>verifyDdt({...actual,id_causale:[[1,2]]},prep,payload),/Causale/);
 assert.throws(()=>verifyDdt({...actual,nota:[[1,`Altra nota | ALL:${prep.id}`]]},prep,payload),/Note/);
 assert.throws(()=>buildDdt(prep,{source,raw:f.raw},allocations,{ddt_series:1},'20261031','x'.repeat(1001)),/1000/);
 assert.throws(()=>buildDdt(prep,{source,raw:f.raw},allocations,{ddt_series:1},'20261031',{}),/Note/);
});
