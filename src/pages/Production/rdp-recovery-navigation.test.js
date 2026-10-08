import assert from "node:assert/strict";
import test from "node:test";
import {workbenchMatchesTab} from "./rdp-workbench-state.js";
test("a pending deleted OCT is visible in recovery while its real running stage stays unchanged",()=>{
 const row={stage:"production",sourceDeletedAt:"2026-01-01",mesDeletedAt:null};
 assert.equal(workbenchMatchesTab(row,"blocked"),true);
 assert.equal(workbenchMatchesTab(row,"production"),true);
 assert.equal(row.stage,"production");
 assert.equal(workbenchMatchesTab({...row,mesDeletedAt:"2026-01-02"},"blocked"),false);
 assert.equal(workbenchMatchesTab({stage:"history"},"all"),false);
});
