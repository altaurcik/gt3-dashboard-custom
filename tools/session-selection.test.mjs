import test from "node:test";
import assert from "node:assert/strict";
import { event } from "../src/event.mjs";
import { selectRace, raceMetadata, scheduleTime } from "../src/session-selection.mjs";

const gt4 = { Id: "gt4-race", CompetitionId: "gt4", Name: "Race 1", Type: 0, State: 1, ListIndex: 20,
  BeginTime: "17.10.2026 15:10:00", EndTime: "17.10.2026 16:10:00", Duration: "1:00:00" };
const gt3 = { Id: event.raceId, CompetitionId: event.competitionId, Name: "Race", Type: 0, State: 0,
  ListIndex: 30, BeginTime: "17.10.2026 17:00:00", Duration: "3:00:00" };
const schedule = () => ({ PresentationRoundId: gt4.Id, Units: { gt4: { ...gt4 }, gt3: { ...gt3 } },
  Competitions: { gt4: { SerieId: "gt4-series" } }, Series: { "gt4-series": { Name: "GT4 European Series", ShortName: "GT4" } } });

test("current race follows active GT4, while the pinned view always selects the Verstappen race", () => {
  assert.equal(selectRace(schedule()).unit.Id, gt4.Id);
  assert.equal(selectRace(schedule(), "gt3").unit.Id, event.raceId);
  const next = schedule(); next.Units.gt4.State = 2; next.Units.gt3.State = 1;
  assert.equal(selectRace(next).unit.Id, event.raceId);
});
test("presentation practice or qualifying never enters the race dashboard", () => {
  const next = schedule(); next.Units.q = { Id: "q", Type: 6, State: 1, ListIndex: 40 }; next.PresentationRoundId = "q";
  assert.equal(selectRace(next).unit.Id, gt4.Id);
  next.Units.gt4.State = 0; next.Units.gt4.BeginTime = "17.10.2026 15:10:00";
  assert.equal(selectRace(next, "auto", Date.parse("2026-10-17T14:00:00Z")).unit.Id, gt4.Id);
});
test("finished presentation remains explicit until another race goes live", () => {
  const next = schedule(); next.Units.gt4.State = 2;
  assert.equal(selectRace(next).reason, "completed");
  next.Units.gt3.State = 1;
  assert.equal(selectRace(next).reason, "active");
  assert.equal(selectRace(next).unit.Id, event.raceId);
});
test("series metadata and local schedule are independent of the machine timezone and favorite crew", () => {
  const meta = raceMetadata(schedule(), gt4);
  assert.equal(meta.seriesName, "GT4 European Series"); assert.equal(meta.seriesCode, "GT4");
  assert.equal(meta.start, "2026-10-17T14:10:00.000Z"); assert.equal(meta.durationSeconds, 3600);
  assert.equal(meta.favorite, null); assert.equal(meta.isVerstappenRace, false);
  assert.equal(raceMetadata(schedule(), gt3).favorite, "3");
  assert.equal(scheduleTime("invalid"), null);
});
