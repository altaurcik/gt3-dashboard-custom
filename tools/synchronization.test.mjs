import test from "node:test";
import assert from "node:assert/strict";
import { completedLapSectors, ObservationHistory } from "../src/normalize.mjs";
import { synchronizedGap } from "../public/race-metrics.js";
import { TimingPositions } from "../public/track-positions.js";

const sectors = (...times) => times.map((time) => ({ time, state: 0 }));
const row = (extra = {}) => ({ number: "3", laps: 2, sectorLapNumber: 3, totalTime: "3:30.000", last: "1:45.000", lastLapNumber: 2,
  position: 6, classPosition: 5, progress: 2, status: 2, inPit: false, driver: null, sectors: sectors("32.612", "33.180"), ...extra });
const snap = (car) => ({ raceAvailable: true, session: { id: "race", state: 1, complete: false, flag: "GREEN" }, rows: [car], messages: [] });

test("missing S3 is exactly the measured full lap minus measured S1/S2, with no invented splits", () => {
  const result = completedLapSectors(104.508, sectors("32.612", "33.180"));
  assert.equal(result[2].time, "38.716"); assert.equal(result[2].derived, true);
  assert.equal(completedLapSectors(104.508, sectors("32.612"))[2], null);
  assert.equal(completedLapSectors(60, sectors("32.612", "33.180"))[2], null);
});
test("sector history survives a feed reset to next lap, and never borrows splits from a different lap", () => {
  const history = new ObservationHistory(); history.update(snap(row()), 1000);
  const next = history.update(snap(row({ laps: 3, sectorLapNumber: 4, lastLapNumber: 3, last: "1:44.508", totalTime: "5:14.508", sectors: sectors("32.900") })), 2000);
  const completed = next.history["3"][0];
  assert.deepEqual(completed.sectors.map((s) => s.time), ["32.612", "33.180", "38.716"]);
  assert.equal(completed.totalTime, "5:14.508"); assert.equal(completed.mapEligible, true);
  const skipped = history.update(snap(row({ laps: 5, sectorLapNumber: 6, lastLapNumber: 5, last: "1:44.508", totalTime: "8:44.000", sectors: [] })), 3000);
  assert.deepEqual(skipped.history["3"].at(-1).sectors, [null, null, null]);
  assert.equal(skipped.history["3"].at(-1).mapEligible, false);
});
test("pit laps are not used as on-track map trajectories", () => {
  const history = new ObservationHistory(); history.update(snap(row({ inPit: true })), 1000);
  const result = history.update(snap(row({ laps: 3, lastLapNumber: 3, sectorLapNumber: 4 })), 2000);
  assert.equal(result.history["3"][0].mapEligible, false);
});
test("real snapshot 219 transient 1L becomes a same-lap time gap, while genuine full-lap gaps remain", () => {
  const leader = { number: "17", laps: 49, lastLapNumber: 49, totalTime: "1:29:31.217", last: "1:44.874", best: "1:44.479" };
  const favorite = { number: "3", laps: 48, totalTime: "1:27:51.974" };
  assert.equal(synchronizedGap(favorite, leader, "1L").value, "5.631");
  const previous = { number: "80", laps: 49, lastLapNumber: 49, totalTime: "1:29:34.882", last: "1:45.175", best: "1:44.500" };
  assert.equal(synchronizedGap({ laps: 48, totalTime: "1:27:50.246" }, previous, "1L").value, "0.539");
  assert.equal(synchronizedGap({ laps: 48, totalTime: "1:30:00.000" }, leader, "1L").value, "1L");
  assert.equal(synchronizedGap(favorite, { ...leader, last: "3:30.000" }, "1L").value, "1L");
  assert.equal(synchronizedGap(favorite, { ...leader, best: null }, "1L").value, "1L");
  assert.equal(synchronizedGap(favorite, { ...leader, lastLapNumber: null }, "1L").value, null);
  assert.equal(synchronizedGap(favorite, leader, "2.337").value, "2.337");
  assert.equal(synchronizedGap({ laps: 0, totalTime: "0.000" }, leader, "1L").value, null);
});
test("map replays reconstructed S3 continuously when full S3 packets were never received", () => {
  const p = new TimingPositions();
  const full = (lap, total) => ({ lap, totalTime: total, sectors: sectors("30.000", "40.000", "50.000"), mapEligible: true });
  let current = row({ laps: 10, sectorLapNumber: 11, totalTime: "16:40.000", progress: 1, sectors: sectors("30.000") });
  let history = [full(10, "16:40.000")];
  const frame = () => ({ ...snap(current), history: { "3": history } });
  p.update(frame(), 0); let previous = p.positions(0)[0].distance;
  for (let sec = 1; sec <= 140; sec++) {
    if (sec === 40) { current = { ...current, progress: 2, sectors: sectors("30.000", "40.000") }; p.update(frame(), sec * 1000); }
    if (sec === 90) { current = { ...current, laps: 11, sectorLapNumber: 12, totalTime: "18:40.000", sectors: [], progress: 0 }; history = [...history, full(11, "18:40.000")]; p.update(frame(), sec * 1000); }
    if (sec === 120) { current = { ...current, sectors: sectors("30.000"), progress: 1 }; p.update(frame(), sec * 1000); }
    const point = p.positions(sec * 1000)[0];
    assert.equal(point.replaying, true, `not replaying at ${sec}`);
    assert.ok(point.distance > previous, `stopped at ${sec}`); previous = point.distance;
  }
});
test("fresh data resynchronizes an exhausted replay clock instead of leaving every car held", () => {
  const p = new TimingPositions();
  p.update(snap(row({ laps: 10, sectorLapNumber: 10, totalTime: "16:40.000", sectors: sectors("30.000", "40.000", "50.000") })), 0);
  assert.equal(p.positions(90000)[0].replaying, false);
  p.update(snap(row({ laps: 10, sectorLapNumber: 11, totalTime: "16:40.000", sectors: sectors("30.000"), progress: 1 })), 90000);
  assert.equal(p.positions(90000)[0].replaying, true);
});
