import test from "node:test";
import assert from "node:assert/strict";
import { loadRunInputs } from "./lib/runInputs.js";

function store() {
  const rows = new Map();
  return { rows, from(table) {
    assert.equal(table, "mexal_sync_run_inputs");
    return {
      select() { return { eq(_column, id) {
        const read = async () => ({ data: rows.has(id) ? { inputs: structuredClone(rows.get(id)) } : null });
        return { maybeSingle: read, single: read };
      } }; },
      async upsert(row, options) {
        assert.equal(options.ignoreDuplicates, true);
        if (!rows.has(row.sync_run_id)) rows.set(row.sync_run_id, structuredClone(row.inputs));
        return {};
      },
    };
  } };
}

test("legacy runs always use the original reader, without snapshot queries or writes", async () => {
  let reads = 0;
  const supabase = { from() { assert.fail("legacy DB must not be touched"); } };
  const run = { id: 666, processed: 5448, metadata: { next_offset: 5448 } };
  const before = structuredClone(run);
  for (let i = 0; i < 2; i++) await loadRunInputs({ supabase, run, load: async () => ++reads });
  assert.equal(reads, 2);
  assert.deepEqual(run, before);
});

test("new run loads catalog once; subsequent batches and process restarts reuse identical ordering", async () => {
  const supabase = store(); let reads = 0;
  const run = { id: 700, processed: 0, metadata: { inputs_version: 1 } };
  const load = async () => { reads++; return { articles: ["MP1", "IT2"], warehouses: [5] }; };
  const first = await loadRunInputs({ supabase, run, load });
  first.articles.reverse(); // A caller cannot mutate persisted input ordering.
  const resumed = await loadRunInputs({ supabase, run: { ...run, processed: 12 }, load });
  assert.deepEqual(resumed.articles, ["MP1", "IT2"]);
  assert.equal(reads, 1);
});

test("separate runs get fresh catalogs instead of sharing old snapshots", async () => {
  const supabase = store(); let reads = 0;
  for (const id of [700, 701]) await loadRunInputs({ supabase, run: { id, metadata: { inputs_version: 1 } }, load: async () => ({ revision: ++reads }) });
  assert.equal(reads, 2);
  assert.equal(supabase.rows.size, 2);
});

test("missing snapshot after progress cannot silently rebuild / skip articles", async () => {
  const supabase = store();
  await assert.rejects(loadRunInputs({ supabase, run: { id: 700, processed: 12, metadata: { inputs_version: 1 } }, load: async () => assert.fail("must not rebuild") }), /proteggere il checkpoint/);
  assert.equal(supabase.rows.size, 0);
});

test("concurrent first loads converge on the first immutable snapshot", async () => {
  const supabase = store(); const run = { id: 700, processed: 0, metadata: { inputs_version: 1 } };
  const results = await Promise.all(["a", "b"].map((revision) => loadRunInputs({ supabase, run, load: async () => ({ revision }) })));
  assert.deepEqual(results[0], results[1]);
});
