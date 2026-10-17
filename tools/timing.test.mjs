import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { event, channel } from "../src/event.mjs";
import { normalize, flagName, seconds, ObservationHistory } from "../src/normalize.mjs";
import { TimingProvider } from "../src/provider.mjs";
import { averagePace, formatLapTime, sectorFill } from "../public/race-metrics.js";

// Synthetic, isolated contract fixtures. Never used by the running dashboard.
const unit = (id, state, type) => ({ Id: id, State: state, Type: type, Name: type === 6 ? "Combined Qualifying" : "Race", Code: type === 6 ? "CQ" : "R", CompetitionId: event.competitionId });
const driver = (id, name) => ({ Id: id, FirstName: name, LastName: "Test", ShortName: id, ListIndex: id === "A" ? 1 : 2 });
function payload(id, lap = 2, inPit = false, current = "A") {
  return {
    timing: { UnitId: id, UntInfo: { TrackFlag: 1, RemainingTime: "2:59:00" }, Results: { car: { MainResult: { Rank: 14, RankingTime: "1:42.624", LastLap: { Time: "1:44.123", LapNumber: lap }, TotalLapCount: lap, Status: 1 }, SourceResults: [{ BestTime: "1:43.124" }] } } },
    detail: { UnitId: id, Competitors: { car: { Id: "car", Bib: "3", TeamName: "Contract fixture", CurrentDriverId: current, InPitLane: inPit, PitStopCount: inPit ? 1 : 0, Drivers: { A: driver("A", "First"), B: driver("B", "Second") } }, safety: { Id: "safety", Bib: "SC", Drivers: {} } }, Classes: {}, Messages: [{ Time: "17:01:00", Text: "GREEN FLAG" }] },
  };
}
function snapshot({ id = event.raceId, lap = 2, inPit = false, current = "A", state = 1, type = 0, flag = 1 } = {}) {
  const p = payload(id, lap, inPit, current); p.timing.UntInfo.TrackFlag = flag;
  return normalize(p.timing, p.detail, unit(id, state, type), { mode: type === 6 ? "qualifying" : "race", receivedAt: 1000, changedAt: 1000, uid: lap, detailUid: lap, sourceUrl: "https://example.invalid/test" });
}

test("combined qualifying never reports last driver as currently driving or pit counts as race data", () => {
  const result = snapshot({ id: event.qualifyingId, state: 2, type: 6 });
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].driver, null);
  assert.equal(result.rows[0].pitStops, null);
  assert.equal(result.rows[0].inPit, null);
  assert.equal(result.rows[0].average, "1:42.624");
  assert.equal(result.session.complete, true);
  assert.equal(result.coverage.gps, false);
});
test("session identity is enforced, preventing racing data from another session", () => {
  const p = payload(event.qualifyingId);
  assert.throws(() => normalize(p.timing, p.detail, unit(event.raceId, 1, 0), {}), /mismatch/);
});
test("missing numeric fields stay absent instead of becoming a fabricated zero", () => {
  const p = payload(event.raceId); p.timing.Results.car.MainResult = {};
  const r = normalize(p.timing, p.detail, unit(event.raceId, 1, 0), {}).rows[0];
  assert.equal(r.position, null); assert.equal(r.laps, null); assert.equal(r.last, null);
});
test("flags respect safety precedence and unknown flags stay unknown", () => {
  assert.equal(flagName({ TrackFlag: 1 | 8 }), "RED");
  assert.equal(flagName({ TrackFlag: 32 | 4 }), "SAFETY CAR");
  assert.equal(flagName({ TrackFlag: 64 }), "FCY");
  assert.equal(flagName({ TrackFlag: 0 }), "UNKNOWN");
  assert.equal(flagName({ ChequeredFlag: true, TrackFlag: 1 }), "CHEQUERED");
});
test("history does not manufacture initial laps, duplicate laps, or pit events from the initial state", () => {
  const history = new ObservationHistory();
  const initial = history.update(snapshot(), 1000);
  assert.equal(initial.history["3"].length, 0); assert.equal(initial.pitEvents.length, 0);
  const next = history.update(snapshot({ lap: 3 }), 2000);
  assert.equal(next.history["3"].length, 1); assert.equal(next.history["3"][0].clean, true);
  const repeated = history.update(snapshot({ lap: 3 }), 3000);
  assert.equal(repeated.history["3"].length, 1);
});
test("observed pit entry/exit and driver changes are recorded, pit laps excluded from clean pace", () => {
  const history = new ObservationHistory(); history.update(snapshot(), 1000);
  const entering = history.update(snapshot({ lap: 3, inPit: true }), 2000);
  assert.equal(entering.pitEvents[0].type, "in"); assert.equal(entering.history["3"][0].clean, false);
  const leaving = history.update(snapshot({ lap: 4, current: "B" }), 3000);
  assert.equal(leaving.pitEvents[0].type, "out"); assert.equal(leaving.driverEvents.length, 1);
  assert.equal(leaving.history["3"][1].clean, false);
  const changedSession = history.update(snapshot({ id: event.qualifyingId, state: 2, type: 6 }), 4000);
  assert.deepEqual(changedSession.pitEvents, []); assert.deepEqual(changedSession.history["3"], []);
});
test("caution laps and completed session replays do not enter live pace history", () => {
  const history = new ObservationHistory(); history.update(snapshot(), 1000);
  const caution = history.update(snapshot({ lap: 3, flag: 32 }), 2000);
  assert.equal(caution.history["3"][0].clean, false);
  const returning = history.update(snapshot({ lap: 4 }), 2500);
  assert.equal(returning.history["3"][1].clean, false);
  const completed = history.update(snapshot({ lap: 5, state: 2 }), 3000);
  assert.equal(completed.history["3"].length, 2);
});
test("time parsing accepts lap/remaining times and rejects gaps and sentinels", () => {
  assert.equal(seconds("1:42.624"), 102.624); assert.equal(seconds("3:00:00"), 10800);
  for (const input of [null, "", "—", "+1 lap", "1:ab", "NaN"]) assert.equal(seconds(input), null);
});
test("provider waits for a race, switches to it, then preserves stale data on upstream loss", async (context) => {
  const dir = await mkdtemp(path.join(tmpdir(), "gt3-provider-test-"));
  context.after(() => rm(dir, { recursive: true, force: true }));
  let racing = false, offline = false, clock = 100000;
  const requested = [];
  const fetcher = async (url) => {
    requested.push(url);
    if (offline) throw new Error("simulated network outage");
    const name = new URL(url).pathname.split("/").at(-1).replace(/\.json$/, "");
    let data;
    if (name.includes("SCHEDULE")) data = { MeetingId: event.meetingId, Units: { q: unit(event.qualifyingId, 2, 6), r: unit(event.raceId, racing ? 1 : 0, 0) } };
    else {
      const race = name.includes(event.raceId.toUpperCase());
      if (race && !racing) return new Response("", { status: 404 });
      const p = payload(race ? event.raceId : event.qualifyingId);
      data = name.includes("COMP_DETAIL") ? p.detail : p.timing;
    }
    return Response.json({ uid: racing ? 2 : 1, content: { full: data } });
  };
  const provider = new TimingProvider({ fetcher, cacheDir: pathToFileURL(dir + path.sep), clock: () => clock });
  const waiting = await provider.getSnapshot(true);
  assert.equal(waiting.session.mode, "race"); assert.equal(waiting.session.id, event.raceId);
  assert.equal(waiting.raceAvailable, false); assert.deepEqual(waiting.rows, []);
  assert.equal(waiting.coverage.timing, false);
  assert.ok(requested.every((url) => !url.includes(event.qualifyingId.toUpperCase())));
  racing = true; clock += 20000;
  const race = await provider.getSnapshot(true);
  assert.equal(race.session.mode, "race"); assert.equal(race.raceAvailable, true);
  assert.equal(race.rows[0].driver.id, "A"); assert.deepEqual(race.history["3"], []);
  offline = true; clock += 20000;
  const stale = await provider.getSnapshot(true);
  assert.equal(stale.source.connection, "stale"); assert.equal(stale.session.mode, "race");
  assert.equal(stale.rows[0].position, 14); assert.match(stale.source.error, /outage/);
});
test("offline startup rejects a cached qualifying snapshot", async (context) => {
  const dir = await mkdtemp(path.join(tmpdir(), "gt3-race-only-test-"));
  context.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(path.join(dir, "snapshot.json"), JSON.stringify(snapshot({ id: event.qualifyingId, state: 2, type: 6 })));
  const provider = new TimingProvider({ cacheDir: pathToFileURL(dir + path.sep),
    fetcher: async () => { throw new Error("offline"); } });
  const result = await provider.getSnapshot(true);
  assert.equal(result.session.mode, "race"); assert.equal(result.session.id, event.raceId);
  assert.equal(result.source.connection, "unavailable"); assert.deepEqual(result.rows, []);
});
test("pace uses the last selected number of valid clean laps and reports sample count", () => {
  const history = [{ clean: true, seconds: 100 }, { clean: false, seconds: 200 },
    { clean: true, seconds: 101 }, { clean: true, seconds: 102 }, { clean: true, seconds: 103 },
    { clean: true, seconds: 0 }, { clean: true, seconds: NaN }];
  const pace = averagePace(history, 3);
  assert.equal(pace.count, 3); assert.equal(pace.seconds, 102);
  assert.equal(averagePace(history, 5).count, 4);
  assert.equal(averagePace([], 10).seconds, null);
  assert.equal(formatLapTime(102.624), "1:42.624");
  assert.equal(formatLapTime(119.9996), "2:00.000");
  assert.equal(formatLapTime(null), "—");
});
test("sector progress respects only the three source sectors without invented mini splits", () => {
  assert.equal(sectorFill(1.4, 0), 1);
  assert.ok(Math.abs(sectorFill(1.4, 1) - 0.4) < 1e-10);
  assert.equal(sectorFill(1.4, 2), 0);
  for (const invalid of [null, NaN, -1, 4]) assert.equal(sectorFill(invalid, 0), null);
  assert.equal(sectorFill(2, 3), null);
});
test("a caution observed mid-lap excludes that lap even after the flag returns to green", () => {
  const history = new ObservationHistory();
  history.update(snapshot({ lap: 2 }), 1000);
  history.update(snapshot({ lap: 2, flag: 32 }), 2000);
  history.update(snapshot({ lap: 2, flag: 1 }), 3000);
  const completed = history.update(snapshot({ lap: 3, flag: 1 }), 4000);
  assert.equal(completed.history["3"][0].clean, false);
  const next = history.update(snapshot({ lap: 4, flag: 1 }), 5000);
  assert.equal(next.history["3"][1].clean, true);
});
test("provider does not turn repeated HTTP success with the same revision into evidence of live changes", async (context) => {
  const dir = await mkdtemp(path.join(tmpdir(), "gt3-channel-test-"));
  context.after(() => rm(dir, { recursive: true, force: true }));
  let clock = 1000;
  const provider = new TimingProvider({ cacheDir: pathToFileURL(dir + path.sep), clock: () => clock,
    fetcher: async () => Response.json({ uid: 7, content: { full: {} } }) });
  const initial = await provider.getChannel(channel("TIMING", event.raceId));
  clock += 60000;
  const repeated = await provider.getChannel(channel("TIMING", event.raceId));
  assert.equal(repeated.changedAt, initial.changedAt);
  assert.notEqual(repeated.receivedAt, initial.receivedAt);
  assert.notEqual(repeated.url, initial.url);
  assert.equal(new URL(repeated.url).searchParams.get("s"), "7");
});

test("live partial LastLap is not a completed lap; single-lap cumulative deltas recover the actual last time", () => {
  const history = new ObservationHistory();
  const partial = (lap, total) => {
    const p = payload(event.raceId, lap);
    p.timing.Results.car.MainResult.TotalTime = total;
    p.timing.Results.car.MainResult.LastLap = { LapNumber: lap + 1, Intermediates: [{ Time: "35.000" }] };
    return normalize(p.timing, p.detail, unit(event.raceId, 1, 0), { mode: "race" });
  };
  const initial = history.update(partial(1, "1:59.167"));
  assert.equal(initial.rows[0].last, null); assert.equal(initial.rows[0].sectorLapNumber, 2);
  const next = history.update(partial(2, "3:59.267"));
  assert.equal(next.rows[0].last, "2:00.100"); assert.equal(next.rows[0].lastLapNumber, 2);
  assert.equal(next.rows[0].lastSource, "observed-total-time-delta"); assert.equal(next.history["3"][0].clean, true);
  assert.equal(history.update(partial(2, "3:59.267")).rows[0].last, "2:00.100");
  const missed = history.update(partial(4, "7:59.267"));
  assert.equal(missed.rows[0].last, null); assert.equal(missed.history["3"].length, 1);
});

test("rolling race control messages accumulate once, newest display order is deterministic, and sessions remain isolated", () => {
  const history = new ObservationHistory();
  const first = snapshot(); first.messages = [{ time: "17.10.2026 15:10:00", text: "START" }]; history.update(first);
  const second = snapshot(); second.messages = [{ time: "17.10.2026 15:12:00", text: "SAFETY CAR" }]; history.update(second);
  const repeated = snapshot(); repeated.messages = second.messages; history.update(repeated);
  assert.deepEqual(repeated.messages.map((m) => m.text), ["START", "SAFETY CAR"]);
  const next = snapshot({ id: "other-race" }); next.messages = []; history.update(next);
  assert.deepEqual(next.messages, []);
});

test("automatic provider switches series without retaining lap or pit history from identical car numbers", async (context) => {
  const dir = await mkdtemp(path.join(tmpdir(), "sro-switch-test-"));
  context.after(() => rm(dir, { recursive: true, force: true }));
  let clock = 1000, active = "gt4-race";
  const provider = new TimingProvider({ cacheDir: pathToFileURL(dir + path.sep), clock: () => clock,
    fetcher: async (url) => {
      const name = new URL(url).pathname;
      const p = payload(active);
      const data = name.includes("SCHEDULE") ? { MeetingId: event.meetingId, PresentationRoundId: active,
        Units: { current: { ...unit(active, 1, 0), CompetitionId: active === event.raceId ? event.competitionId : "gt4" } },
        Competitions: { gt4: { SerieId: "gt4-series" } }, Series: { "gt4-series": { Name: "GT4 European Series" } } }
        : name.includes("COMP_DETAIL") ? p.detail : p.timing;
      return Response.json({ uid: clock, content: { full: data } });
    } });
  const first = await provider.getSnapshot(true);
  assert.equal(first.event.seriesCode, "GT4"); assert.equal(first.event.favorite, null);
  active = event.raceId; clock += 20000;
  const next = await provider.getSnapshot(true);
  assert.equal(next.event.isVerstappenRace, true); assert.deepEqual(next.history["3"], []);
  assert.deepEqual(next.pitEvents, []); assert.equal(next.selection.mode, "auto");
});
