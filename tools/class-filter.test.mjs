import test from "node:test";
import assert from "node:assert/strict";
import { classSnapshot, classComparison, matchesClass, messageCars } from "../public/class-filter.js";
import { resolveComparison } from "../public/comparison-selection.js";

const rows = [{ number: "17", position: 12, className: "Pro" }, { number: "7", position: 13, className: "Gold" },
  { number: "3", position: 14, className: "Pro" }];
const raw = { rows, session: { flag: "GREEN" }, source: { uid: 1 },
  history: { "17": [{ lap: 4 }], "7": [{ lap: 4 }], "3": [{ lap: 4 }] },
  pitEvents: [{ number: "17" }, { number: "7" }], driverEvents: [{ number: "3" }, { number: "7" }],
  messages: [{ text: "FULL COURSE YELLOW IN 20s" }, { text: "CAR 7 TIME PENALTY" },
    { text: "INCIDENT CARS 7-17 T5 NOTED" }, { text: "CAR #3 BLACK / WHITE FLAG" }] };

test("one class snapshot scopes rows, map input, lap history, pits, driver changes and car-specific race control", () => {
  const page = classSnapshot(raw, "Pro");
  assert.deepEqual(page.rows.map((row) => row.number), ["17", "3"]);
  assert.deepEqual(Object.keys(page.history), ["3", "17"]);
  assert.deepEqual(page.pitEvents, [{ number: "17" }]); assert.deepEqual(page.driverEvents, [{ number: "3" }]);
  assert.deepEqual(page.messages.map((m) => m.text), ["FULL COURSE YELLOW IN 20s", "INCIDENT CARS 7-17 T5 NOTED", "CAR #3 BLACK / WHITE FLAG"]);
  assert.equal(page.session, raw.session); assert.equal(page.source, raw.source);
  assert.equal(raw.rows.length, 3); assert.equal(raw.messages.length, 4);
  assert.equal(classSnapshot(raw, "all"), raw);
});
test("car references do not confuse turn numbers, timing durations or Safety Car announcements with car numbers", () => {
  assert.deepEqual(messageCars("INCIDENT CARS 27-12 T4 NOTED"), ["27", "12"]);
  assert.deepEqual(messageCars("CAR 15 - 10SEC TIME PENALTY JUMP START"), ["15"]);
  assert.deepEqual(messageCars("CAR#062 PLEASE CHANGE DRIVER ID"), ["62"]);
  assert.deepEqual(messageCars("CARS 8 AND 9 T5"), ["8", "9"]);
  assert.deepEqual(messageCars("SAFETY CAR 1 LAP"), []);
  assert.deepEqual(messageCars("FULL COURSE YELLOW IN 20s"), []);
});
test("manual choices outside the class disappear only from the view; All restores stored choices", () => {
  const choice = { mode: "manual", a: "3", b: "7" }, page = classSnapshot(raw, "Pro");
  assert.deepEqual(classComparison(choice, page.rows, "Pro"), { mode: "manual", a: "3", b: null });
  assert.equal(classComparison(choice, rows, "all"), choice);
  assert.equal(choice.b, "7");
});
test("automatic comparison follows the crew ahead within the chosen class and never leaks an excluded favorite", () => {
  const ahead = { mode: "ahead", a: "3", b: null };
  const pro = classSnapshot(raw, "Pro"), gold = classSnapshot(raw, "Gold");
  assert.equal(resolveComparison(pro.rows, classComparison(ahead, pro.rows, "Pro"), "3", { withinClass: true }).bNumber, "17");
  assert.equal(resolveComparison(rows, ahead).bNumber, "7");
  assert.deepEqual(classComparison(ahead, gold.rows, "Gold"), { mode: "manual", a: null, b: null });
});
test("empty classes still retain race-wide commands and comparisons normalize official roster casing", () => {
  const page = classSnapshot(raw, "Silver");
  assert.deepEqual(page.rows, []); assert.deepEqual(page.history, {});
  assert.deepEqual(page.messages.map((m) => m.text), ["FULL COURSE YELLOW IN 20s"]);
  assert.ok(matchesClass({ className: "PRO" }, "Pro")); assert.equal(classSnapshot(null, "Pro"), null);
});
