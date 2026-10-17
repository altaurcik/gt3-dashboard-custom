import { event } from "./event.mjs";

export function scheduleTime(value) {
  const match = value?.match(/^(\d{2})\.(\d{2})\.(\d{4}) (\d{2}):(\d{2}):(\d{2})(?:\.\d+)?$/);
  if (!match) return null;
  // This configured Portimão weekend is in WEST (UTC+1), independent of the host TZ.
  const [, day, month, year, hour, minute, second] = match;
  return Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second)) - 3600000;
}

export function selectRace(schedule, mode = "auto", now = Date.now()) {
  const races = Object.values(schedule.Units ?? {}).filter((unit) => unit.Type === 0);
  if (mode === "gt3") return { unit: races.find((unit) => unit.Id === event.raceId) ?? null, reason: "pinned" };
  const presentation = races.find((unit) => unit.Id === schedule.PresentationRoundId);
  if (presentation?.State === 1) return { unit: presentation, reason: "active" };
  const active = races.filter((unit) => unit.State === 1).sort((a, b) => (b.ListIndex ?? 0) - (a.ListIndex ?? 0));
  if (active.length) return { unit: active[0], reason: "active" };
  if (presentation?.State >= 2) return { unit: presentation, reason: "completed" };
  const upcoming = races.filter((unit) => unit.State === 0 && (scheduleTime(unit.BeginTime) ?? Infinity) >= now)
    .sort((a, b) => (scheduleTime(a.BeginTime) ?? Infinity) - (scheduleTime(b.BeginTime) ?? Infinity));
  if (upcoming.length) return { unit: upcoming[0], reason: "upcoming" };
  const completed = races.filter((unit) => unit.State >= 2).sort((a, b) => (b.ListIndex ?? 0) - (a.ListIndex ?? 0));
  if (completed.length) return { unit: completed[0], reason: "completed" };
  return { unit: races.find((unit) => unit.Id === event.raceId) ?? null, reason: "waiting" };
}

export function raceMetadata(schedule, unit) {
  const competition = schedule.Competitions?.[unit.CompetitionId];
  const series = schedule.Series?.[competition?.SerieId];
  const isVerstappenRace = unit.Id === event.raceId && unit.CompetitionId === event.competitionId;
  const seriesName = series?.Name ?? competition?.Name ?? (isVerstappenRace ? "GT World Challenge Europe · Endurance Cup" : "Race series");
  const start = scheduleTime(unit.BeginTime);
  const end = scheduleTime(unit.EndTime);
  const duration = unit.Duration?.split(":").reduce((sum, part) => sum * 60 + Number(part), 0);
  const seriesCode = isVerstappenRace ? "GT3" : /GT4/i.test(seriesName) ? "GT4" : /GT2/i.test(seriesName) ? "GT2" : /McLaren/i.test(seriesName) ? "McLaren" : series?.ShortName ?? "SRO";
  return { ...event, raceId: unit.Id, competitionId: unit.CompetitionId, seriesId: competition?.SerieId ?? null,
    seriesName, seriesShortName: series?.ShortName ?? seriesName, seriesCode, isVerstappenRace,
    favorite: isVerstappenRace ? "3" : null,
    start: start === null ? (isVerstappenRace ? event.start : null) : new Date(start).toISOString(),
    end: end === null ? null : new Date(end).toISOString(),
    durationSeconds: Number.isFinite(duration) ? duration : isVerstappenRace ? event.durationSeconds : null };
}
