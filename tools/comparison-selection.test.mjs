import test from "node:test";
import assert from "node:assert/strict";
import { comparisonSelection, resolveComparison, chooseComparisonSide } from "../public/comparison-selection.js";

const rows = [{ number: "17", position: 12 }, { number: "7", position: 13 }, { number: "3", position: 14 }, { number: "32", position: 15 }];
test("default compares #3 with the exact crew immediately ahead overall, independent of array order or team", () => {
  const result = resolveComparison([...rows].reverse());
  assert.equal(result.aNumber, "3"); assert.equal(result.bNumber, "7"); assert.equal(result.mode, "ahead");
});
test("automatic opponent follows overtakes instead of retaining a fixed car", () => {
  const first = resolveComparison(rows);
  const after = resolveComparison(rows.map((r) => ({ ...r, position: r.number === "3" ? 13 : r.number === "7" ? 14 : r.position })));
  assert.equal(first.bNumber, "7"); assert.equal(after.bNumber, "17");
});
test("leader, missing timing, unranked favorite and missing immediate predecessor do not invent an opponent", () => {
  assert.equal(resolveComparison([]).bNumber, null);
  assert.equal(resolveComparison([]).reason, "waiting");
  assert.equal(resolveComparison([{ number: "3", position: 1 }]).reason, "leader");
  assert.equal(resolveComparison([{ number: "3", position: null }]).reason, "unranked");
  assert.equal(resolveComparison([{ number: "3", position: 0 }]).bNumber, null);
  assert.equal(resolveComparison([{ number: "3", position: 14 }, { number: "17", position: 12 }]).reason, "ahead-unavailable");
  assert.equal(resolveComparison([{ number: "17", position: 13 }]).reason, "favorite-missing");
});
test("manual choice stays fixed when race order changes and can select any two different crews", () => {
  const preference = { mode: "manual", a: "17", b: "32" };
  const result = resolveComparison(rows, preference);
  const after = resolveComparison([...rows].reverse(), preference);
  assert.equal(result.aNumber, "17"); assert.equal(result.bNumber, "32");
  assert.equal(after.aNumber, "17"); assert.equal(after.bNumber, "32");
});
test("choosing the other selected crew swaps slots instead of comparing the same crew with itself", () => {
  const current = resolveComparison(rows, { mode: "manual", a: "3", b: "7" });
  assert.deepEqual(chooseComparisonSide(current, "a", "7"), { mode: "manual", a: "7", b: "3" });
  assert.deepEqual(chooseComparisonSide(current, "b", "3"), { mode: "manual", a: "7", b: "3" });
});
test("manual pre-race selection survives missing race data without fabricating a timing row", () => {
  const preference = { mode: "manual", a: "3", b: "46" };
  const result = resolveComparison([], preference);
  assert.equal(result.aNumber, "3"); assert.equal(result.bNumber, "46");
  assert.equal(result.a, null); assert.equal(result.b, null);
});
test("automatic mode preserves the chosen anchor and rejects duplicated or malformed stored choices", () => {
  assert.deepEqual(comparisonSelection(), { mode: "ahead", a: "3", b: null });
  assert.deepEqual(comparisonSelection({ mode: "manual", a: "3", b: "3" }), { mode: "manual", a: "3", b: null });
  assert.deepEqual(comparisonSelection({ mode: "ahead", a: "32", b: "17" }), { mode: "ahead", a: "32", b: null });
  assert.deepEqual(comparisonSelection({ mode: "manual", a: "<bad>", b: "7" }), { mode: "manual", a: null, b: "7" });
});
test("enabling auto follows the selected A instead of replacing it with #3", () => {
  const manual = resolveComparison(rows, { mode: "manual", a: "32", b: "17" });
  const choice = comparisonSelection({ mode: "ahead", a: manual.aNumber });
  const automatic = resolveComparison(rows, choice);
  assert.equal(automatic.aNumber, "32"); assert.equal(automatic.bNumber, "3");
  assert.deepEqual(resolveComparison(rows, JSON.parse(JSON.stringify(choice))), automatic);
});
test("changing A in auto mode keeps tracking; choosing B or clearing A returns to manual", () => {
  const current = resolveComparison(rows);
  const changed = chooseComparisonSide(current, "a", "7");
  assert.deepEqual(changed, { mode: "ahead", a: "7", b: null });
  assert.equal(resolveComparison(rows, changed).bNumber, "17");
  assert.deepEqual(chooseComparisonSide(current, "b", "32"), { mode: "manual", a: "3", b: "32" });
  assert.deepEqual(chooseComparisonSide(current, "a", ""), { mode: "manual", a: null, b: "7" });
});
test("auto uses the closest predecessor in the filtered class for any selected A", () => {
  const choice = { mode: "ahead", a: "32" };
  const filtered = rows.filter((row) => row.number !== "3");
  assert.equal(resolveComparison(filtered, choice, "3", { withinClass: true }).bNumber, "7");
  assert.equal(resolveComparison([rows[3]], choice, "3", { withinClass: true }).reason, "leader");
});
