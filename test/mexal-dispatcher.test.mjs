import assert from "node:assert/strict";
import test from "node:test";
import { isDue, nextRun } from "../api/cron/mexal-dispatcher.js";

const daily = { enabled: true, schedule_mode: "daily", hour: 0, minute: 0 };
test("dispatcher respects Europe/Rome midnight in summer time", () => {
  assert.equal(isDue(daily, new Date("2026-07-18T22:00:00.000Z")), true);
  assert.equal(isDue(daily, new Date("2026-07-18T22:05:00.000Z")), false);
});
test("dispatcher respects Europe/Rome midnight after daylight-saving change", () => {
  assert.equal(isDue(daily, new Date("2026-10-24T22:00:00.000Z")), true);
  assert.equal(isDue(daily, new Date("2026-10-25T23:00:00.000Z")), true);
});
test("interval schedule uses the configured frequency", () => {
  const schedule = { enabled: true, schedule_mode: "interval", frequency_minutes: 15 };
  assert.equal(isDue(schedule, new Date()), true);
  assert.equal(nextRun(schedule, new Date("2026-01-01T00:00:00Z")), "2026-01-01T00:15:00.000Z");
});
