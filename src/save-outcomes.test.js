import assert from "node:assert/strict";
import test from "node:test";
import { createSaveOutcome, subscribeSaveOutcomes } from "./save-outcomes.js";
test("no success before persistence completes; exactly one outcome",async()=>{
 const messages=[],unsubscribe=subscribeSaveOutcomes(x=>messages.push(x));const save=createSaveOutcome();
 await Promise.resolve();assert.equal(messages.length,0);save.success();save.success();
 assert.equal(messages.length,1);assert.match(messages[0].message,/effettuato correttamente/);unsubscribe();
});
test("a reported error cannot be overwritten by fallthrough success",()=>{
 const messages=[],unsubscribe=subscribeSaveOutcomes(x=>messages.push(x));const save=createSaveOutcome();
 save.failure({message:"Impegni occupati da revisione RDP180"});save.success();
 assert.equal(messages.length,1);assert.match(messages[0].message,/RDP180/);assert.equal(messages[0].type,"error");unsubscribe();
});
test("validation error is shown while an empty reset is ignored",()=>{
 const messages=[],unsubscribe=subscribeSaveOutcomes(x=>messages.push(x));const save=createSaveOutcome();
 save.failure("");save.failure(null);assert.equal(messages.length,0);save.failure("Quantità obbligatoria");
 assert.match(messages[0].message,/Quantità obbligatoria/);unsubscribe();
});

test("typed validation keeps the original message and reports the actual reason",()=>{
 const messages=[],off=subscribeSaveOutcomes(x=>messages.push(x)),save=createSaveOutcome();
 const value={type:"error",text:"Seleziona il cliente"};assert.equal(save.observeMessage(value),value);save.success();
 assert.equal(messages.length,1);assert.match(messages[0].message,/Seleziona il cliente/);off();
});
test("a partial result remains partial after normal handler completion",()=>{
 const messages=[],off=subscribeSaveOutcomes(x=>messages.push(x)),save=createSaveOutcome();
 save.partial("SL creato; CL in attesa degli impegni materiali");save.success();
 assert.equal(messages.length,1);assert.equal(messages[0].type,"warning");assert.match(messages[0].message,/SL creato; CL in attesa/);off();
});
