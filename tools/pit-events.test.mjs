import test from "node:test";
import assert from "node:assert/strict";
import { pitTimeline, driverAtEvent } from "../public/pit-events.js";

test("pit events and a simultaneous driver change are one structured car event without repeated car/time", () => {
  const pits = [{ number: "53", type: "out", time: 2000, lap: 16 }, { number: "53", type: "in", time: 1000, lap: 15 }];
  const changes = [{ number: "53", from: "Davide Meloni", to: "Paolo Meloni", time: 2000 }];
  const result = pitTimeline(pits, changes, [{ number: "53", team: "W&D Racing Team" }]);
  assert.equal(result.length, 2); assert.deepEqual(result[0].actions, ["out", "change"]);
  assert.equal(result[0].number, "53"); assert.equal(result[0].lap, 16); assert.equal(result[0].team, "W&D Racing Team");
  assert.deepEqual(result[0].changes, [{ from: "Davide Meloni", to: "Paolo Meloni" }]);
  assert.equal(result[0].driver, null); assert.equal(result[1].driver, null);
  assert.deepEqual(pits.map((event) => event.time), [2000, 1000]);
});
test("different cars or observation times are never folded into an invented single pit stop", () => {
  const result = pitTimeline([{ number: "1", type: "in", time: 1000, lap: 3 }, { number: "1", type: "out", time: 3000, lap: 3 }, { number: "2", type: "in", time: 1000, lap: 3 }]);
  assert.deepEqual(result.map((event) => [event.number, event.time]), [["1", 3000], ["1", 1000], ["2", 1000]]);
  assert.equal(result[0].team, null); assert.equal(result[0].driver, null);
  assert.equal("duration" in result[0], false);
});
test("historical pilot comes from a preceding recorded handover, never today's current driver or an unobserved early stint", () => {
  const changes = [{ number: "71", from: "Charlie", to: "Ravi", time: 2000 }, { number: "71", from: "Ravi", to: "Charlie", time: 5000 }];
  assert.equal(driverAtEvent("71", 1000, changes), null);
  assert.equal(driverAtEvent("71", 3000, changes), "Ravi");
  assert.equal(driverAtEvent("71", 6000, changes), "Charlie");
  assert.equal(driverAtEvent("28", 3000, changes), null);
  const result = pitTimeline([{ number: "71", type: "in", time: 3000 }], changes, [{ number: "71", driver: { name: "Current driver must not override history" } }]);
  assert.equal(result.find((event) => event.time === 3000).driver, "Ravi");
});
test("inconsistent handover history does not fabricate a historical driver", () => {
  assert.equal(driverAtEvent("1", 3000, [{ number: "1", from: "A", to: "B", time: 2000 }, { number: "1", from: "C", to: "D", time: 5000 }]), null);
});
test("duplicate records do not repeat action tags, unknown types and missing timestamps do not become pit events", () => {
  const event = { number: "1", type: "in", time: 1000, lap: 2 };
  const result = pitTimeline([event, event, { ...event, type: "unknown" }, { ...event, time: null }, { ...event, number: "SC" }]);
  assert.equal(result.length, 1); assert.deepEqual(result[0].actions, ["in"]);
});
