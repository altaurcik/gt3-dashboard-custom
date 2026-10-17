import test from "node:test";
import assert from "node:assert/strict";
import { newestRaceMessages, raceEventStyle } from "../public/race-control.js";

test("Race Control always displays newest timestamps first for ascending, descending or shuffled source order", () => {
  const rows = [
    { time: "17.10.2026 15:18:54", text: "INCIDENT INVOLVING CAR 87 T3" },
    { time: "17.10.2026 15:19:38", text: "CAR 27 PITLANE UNDER INVESTIGATION" },
    { time: "17.10.2026 15:19:58", text: "FULL COURSE YELLOW IN 20s" },
  ];
  const expected = [rows[2], rows[1], rows[0]];
  for (const input of [rows, [...rows].reverse(), [rows[1], rows[2], rows[0]]]) {
    const before = [...input];
    assert.deepEqual(newestRaceMessages(input), expected);
    assert.deepEqual(input, before);
  }
  assert.deepEqual(newestRaceMessages(expected), expected);
});

test("Race Control orders across dates without relying on DD.MM browser parsing; missing times stay last", () => {
  const rows = [{ time: null, text: "No timestamp" }, { time: "31.12.2026 23:59:59" },
    { time: "01.01.2027 00:00:01" }, { time: "01.11.2026 00:00:00" }];
  assert.deepEqual(newestRaceMessages(rows), [rows[2], rows[1], rows[3], rows[0]]);
  assert.deepEqual(newestRaceMessages(), []);
});

test("SRO text maps to F1 semantic event tones, with penalties and investigations taking precedence over context words", () => {
  const cases = [
    ["CAR 32 TIME PENALTY 5s TRACK LIMITS", "red", "Penalty"],
    ["RED FLAG", "red", "Red flag"],
    ["CAR 88 BLUE FLAG", "blue", "Blue flag"],
    ["FULL COURSE YELLOW IN 20s", "yellow", "FCY"],
    ["Full Course Yellow ending on short Notice", "yellow", "FCY"],
    ["RESTART 1ST FCY UNDER INVESTIGATION", "purple", "Investigation"],
    ["INCIDENT CARS 1-75 T2 UNDER INVESTIGATION", "purple", "Investigation"],
    ["CAR 1 BLACK / WHITE FLAG TRACK LIMITS", "orange", "Track Limits"],
    ["CAR 16 FINAL WARNING", "orange", "Warning"],
    ["SAFETY CAR IN THIS LAP", "orange", "Safety Car"],
    ["VSC DEPLOYED", "orange", "Virtual Safety Car"],
    ["GREEN FLAG", "green", "Green"],
    ["PIT EXIT IS OPEN", "green", "Green"],
    ["CAR 75 STOPPED T6 IN SAFE POSITION", "neutral", "Info"],
  ];
  for (const [text, tone, name] of cases) {
    assert.equal(raceEventStyle({ text }).tone, tone, text);
    assert.equal(raceEventStyle({ text }).name, name, text);
  }
  assert.equal(raceEventStyle().tone, "neutral");
});
