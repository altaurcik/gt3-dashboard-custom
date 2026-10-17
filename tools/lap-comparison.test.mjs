import test from "node:test";
import assert from "node:assert/strict";
import { compareLaps, formatDelta, deltaWinner } from "../public/lap-comparison.js";

const lap = (number, time, clean = true) => ({ lap: number, time, clean });
test("comparison aligns actual lap numbers and exposes who was faster on each lap", () => {
  const a = [lap(7, "2:04.799"), lap(8, "1:51.872")];
  const b = [lap(8, "1:52.883"), lap(7, "2:04.698")];
  const result = compareLaps({ best: "1:51.872" }, { best: "1:52.883" }, a, b);
  assert.deepEqual(result.laps.map((row) => row.lap), [8, 7]);
  assert.equal(formatDelta(result.laps[0].delta), "−1.011"); assert.equal(result.laps[0].winner, "a");
  assert.equal(formatDelta(result.laps[1].delta), "+0.101"); assert.equal(result.laps[1].winner, "b");
  assert.equal(result.pairedCount, 2); assert.equal(formatDelta(result.paceDelta), "−0.455");
  assert.equal(result.paceWinner, "a"); assert.equal(formatDelta(result.bestDelta), "−1.011");
  assert.deepEqual(a.map((row) => row.lap), [7, 8]);
});
test("matched pace uses only identical clean laps; caution, pit or unobserved laps stay visible but are excluded", () => {
  const result = compareLaps({}, {}, [lap(3, "1:40.000"), lap(4, "1:41.000"), lap(5, "2:20.000", false)],
    [lap(3, "1:42.000"), lap(4, "2:21.000", false), lap(5, "2:22.000")]);
  assert.equal(result.laps.length, 3); assert.equal(result.pairedCount, 1);
  assert.equal(result.paceA, 100); assert.equal(result.paceB, 102); assert.equal(result.paceDelta, -2);
  assert.equal(result.hasExcluded, true);
});
test("lapped cars and missing laps are not compared by array position or latest lap irrespective of number", () => {
  const result = compareLaps({ lastLapNumber: 10, last: "1:40.000" }, { lastLapNumber: 9, last: "1:42.000" });
  assert.deepEqual(result.laps.map((row) => row.lap), [10, 9]);
  assert.ok(result.laps.every((row) => row.delta === null));
  assert.equal(result.pairedCount, 0); assert.equal(result.paceDelta, null);
  const received = compareLaps({ lastLapNumber: 10, last: "1:40.000" }, { lastLapNumber: 10, last: "1:42.000" });
  assert.equal(received.laps[0].delta, -2); assert.equal(received.pairedCount, 0);
});
test("window limits newest real lap numbers, keeps latest corrections and does not invent absent laps", () => {
  const result = compareLaps({}, {}, [lap(2, "1:40.000"), lap(4, "1:41.000"), lap(6, "1:42.000"), lap(8, "1:43.000"), lap(8, "1:44.000")],
    [lap(4, "1:42.000"), lap(6, "1:43.000"), lap(8, "1:45.000")], 3);
  assert.deepEqual(result.laps.map((row) => row.lap), [8, 6, 4]);
  assert.equal(result.laps[0].a.time, "1:44.000"); assert.equal(result.pairedCount, 3);
});
test("missing/invalid values remain absent and deltas round without negative zero or asymmetric signs", () => {
  const result = compareLaps({ best: null }, { best: "1:40.000" }, [lap(1, "—"), lap(2, "0"), lap(null, "1:41.000")]);
  assert.deepEqual(result.laps, []); assert.equal(result.paceA, null); assert.equal(result.bestDelta, null);
  assert.equal(formatDelta(null), "—"); assert.equal(formatDelta(NaN), "—");
  assert.equal(formatDelta(-0.0001), "0.000"); assert.equal(deltaWinner(-0.0001), null);
  assert.equal(formatDelta(-0.0005), "−0.001"); assert.equal(formatDelta(0.0005), "+0.001");
});
