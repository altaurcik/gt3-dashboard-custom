import { event } from "./event.mjs";

export const values = (object) => Object.values(object ?? {});
export function seconds(text) {
  if (typeof text !== "string" || !/^\d+(?::\d{1,2}){0,2}(?:\.\d+)?$/.test(text)) return null;
  return text.split(":").reduce((sum, item) => sum * 60 + Number(item), 0);
}
const finite = (value) => typeof value === "number" && Number.isFinite(value) ? value : null;
const text = (value) => typeof value === "string" ? value : null;
function rememberSectors(row, previous = new Map()) {
  const known = new Map(previous);
  if (Number.isInteger(row.sectorLapNumber) && row.sectorLapNumber > 0) known.set(row.sectorLapNumber, row.sectors.map((sector) => ({ ...sector })));
  return new Map([...known].filter(([lap]) => lap >= (row.laps ?? 0) - 1).slice(-3));
}
export function completedLapSectors(lapSeconds, sectors = []) {
  const result = [0, 1, 2].map((i) => seconds(sectors[i]?.time) > 0 ? { ...sectors[i], derived: false } : null);
  const missing = result.map((sector, i) => sector ? null : i).filter((i) => i !== null);
  if (lapSeconds > 0 && missing.length === 1) {
    const remainder = Math.round((lapSeconds - result.reduce((sum, sector) => sum + (seconds(sector?.time) ?? 0), 0)) * 1000);
    if (remainder > 0) result[missing[0]] = { time: remainder < 60000 ? (remainder / 1000).toFixed(3) : `${Math.floor(remainder / 60000)}:${((remainder % 60000) / 1000).toFixed(3).padStart(6, "0")}`, derived: true };
  }
  return result;
}
export function flagName(info) {
  if (info?.ChequeredFlag) return "CHEQUERED";
  const value = info?.TrackFlag;
  if (!Number.isInteger(value) || value === 0) return "UNKNOWN";
  if (value & 8) return "RED";
  if (value & 32) return "SAFETY CAR";
  if (value & 64) return "FCY";
  if (value & 4) return "YELLOW";
  if (value & 268435456) return "WARM UP";
  return value & 1 ? "GREEN" : "UNKNOWN";
}

export function normalize(timing, detail, unit, { mode, receivedAt, changedAt, uid, detailUid, sourceUrl }) {
  if (!timing || timing.UnitId?.toLowerCase() !== unit.Id?.toLowerCase()) throw new Error("Session ID mismatch in timing");
  if (!detail || detail.UnitId?.toLowerCase() !== unit.Id?.toLowerCase()) throw new Error("Session ID mismatch in competitors");
  const combined = unit.Type === 6;
  const rows = values(detail.Competitors).filter((car) => /^\d+$/.test(car.Bib)).map((car) => {
    const result = timing.Results?.[car.Id];
    const main = result?.MainResult ?? {};
    const completedCount = finite(main.TotalLapCount), sourceLapNumber = finite(main.LastLap?.LapNumber);
    const sourceLast = text(main.LastLap?.Time);
    const completedLast = sourceLast && (completedCount === null || sourceLapNumber === null || sourceLapNumber === completedCount) ? sourceLast : null;
    const drivers = values(car.Drivers).sort((a, b) => a.ListIndex - b.ListIndex).map((d) => ({
      id: d.Id, name: `${d.FirstName ?? ""} ${d.LastName ?? ""}`.trim(), code: d.ShortName,
      firstName: d.FirstName, lastName: d.LastName, country: d.CountryCode, rating: d.LicenseTypeName,
    }));
    const driver = !combined ? drivers.find((d) => d.id === car.CurrentDriverId) ?? null : null;
    return {
      id: car.Id, number: car.Bib, team: text(car.TeamName), car: text(car.CarTypeName),
      manufacturer: text(car.ManufacturerName), className: detail.Classes?.[car.ClassId]?.ShortName ?? null,
      drivers, driver, position: finite(main.Rank), classPosition: finite(main.ClassRank),
      gap: text(main.Behind), interval: text(main.Diff), classGap: text(main.ClassBehind),
      last: completedLast, lastSource: completedLast ? "feed" : null,
      best: text(main.BestTime?.Time), average: combined ? text(main.RankingTime) : null,
      laps: completedCount, lastLapNumber: completedLast ? sourceLapNumber ?? completedCount : null,
      sectorLapNumber: sourceLapNumber, totalTime: text(main.TotalTime),
      pitStops: !combined ? finite(car.PitStopCount) : null,
      inPit: !combined && typeof car.InPitLane === "boolean" ? car.InPitLane : null,
      status: finite(main.Status), progress: finite(main.SectBasedPcntPos),
      sectors: (main.LastLap?.Intermediates ?? []).slice(0, 3).map((s) => ({ time: text(s.Time), state: finite(s.TimeState) })),
      qualifying: (result?.SourceResults ?? []).map((s, i) => ({
        label: detail.SourceRounds?.[i]?.Name ?? `Q${i + 1}`, time: text(s.BestTime),
        driver: drivers[i]?.name ?? null,
      })),
    };
  }).sort((a, b) => (a.position ?? 999) - (b.position ?? 999) || Number(a.number) - Number(b.number));
  const info = timing.UntInfo ?? {};
  const messages = values(detail.Messages).map((message) => ({
    time: text(message.Time), text: text(message.Text) ?? text(message.Message) ?? text(message.MessageText),
  })).filter((message) => message.text).slice(-100);
  return {
    event, session: { id: unit.Id, name: unit.Name, code: unit.Code, type: unit.Type, state: unit.State, mode,
      remaining: text(info.RemainingTime), startRealTime: text(info.StartRealTime), flag: flagName(info),
      complete: unit.State >= 2 || info.ChequeredFlag === true,
    },
    source: { name: "Swiss Timing · SRO", url: sourceUrl, uid, detailUid, receivedAt, changedAt,
      // HTTP retrieval is not proof of an actively changing timing feed.
      connection: "connected", error: null },
    rows, messages, history: {}, pitEvents: [], driverEvents: [],
    coverage: { timing: true, sectors: !combined, miniSectors: false, gps: false, radio: false, tyre: false, weather: false },
  };
}

export class ObservationHistory {
  constructor() { this.session = null; this.cars = new Map(); this.pits = []; this.drivers = []; this.messages = new Map(); }
  restore(snapshot) {
    this.session = snapshot.session.id;
    this.cars = new Map(snapshot.rows.map((row) => [row.number, {
      laps: (snapshot.history?.[row.number] ?? []).slice(-30), completedCount: row.laps,
      totalSeconds: seconds(row.totalTime), baseline: row.laps ?? 0,
      displayLast: row.last && row.lastLapNumber !== null ? { lap: row.lastLapNumber, time: row.last, seconds: seconds(row.last), source: row.lastSource } : null,
      inPit: row.inPit, driver: row.driver, flag: snapshot.session.flag,
      sectorLaps: rememberSectors(row), pitLap: row.inPit !== false,
      // We did not observe the whole current lap while the server was stopped.
      dirtyLap: true,
    }]));
    this.pits = (snapshot.pitEvents ?? []).slice(0, 100);
    this.drivers = (snapshot.driverEvents ?? []).slice(0, 100);
    this.messages = new Map((snapshot.messages ?? []).slice(-100).map((message) => [`${message.time}|${message.text}`, message]));
  }
  update(snapshot, now = Date.now()) {
    if (snapshot.session.id !== this.session) {
      this.session = snapshot.session.id; this.cars.clear(); this.pits = []; this.drivers = []; this.messages.clear();
    }
    const active = snapshot.session.state === 1 && !snapshot.session.complete;
    for (const row of snapshot.rows) {
      const old = this.cars.get(row.number);
      const laps = old?.laps ?? [];
      const sectorLaps = rememberSectors(row, old?.sectorLaps);
      const unsafe = row.inPit !== false || snapshot.session.flag !== "GREEN";
      const newLap = row.laps !== null && old?.completedCount !== null && row.laps > old?.completedCount;
      const oneLap = newLap && row.laps === old.completedCount + 1;
      const totalSeconds = seconds(row.totalTime);
      let completed = row.last && seconds(row.last) > 0 && row.lastLapNumber !== null
        ? { lap: row.lastLapNumber, time: row.last, seconds: seconds(row.last), source: "feed" } : null;
      // The live feed may already describe the next incomplete lap in LastLap.
      // Recover a completed lap only from two observed cumulative times exactly one lap apart.
      if (!completed && oneLap && totalSeconds !== null && old.totalSeconds !== null && totalSeconds > old.totalSeconds) {
        const elapsed = totalSeconds - old.totalSeconds, ms = Math.round(elapsed * 1000);
        completed = { lap: row.laps, seconds: elapsed, source: "observed-total-time-delta",
          time: `${Math.floor(ms / 60000)}:${String(Math.floor(ms % 60000 / 1000)).padStart(2, "0")}.${String(ms % 1000).padStart(3, "0")}` };
      }
      if (!completed && old?.displayLast?.lap === row.laps) completed = old.displayLast;
      if (completed) { row.last = completed.time; row.lastLapNumber = completed.lap; row.lastSource = completed.source; }
      if (active && old) {
        if (row.inPit === true && old.inPit === false) this.pits.unshift({ number: row.number, type: "in", time: now, lap: row.laps });
        if (row.inPit === false && old.inPit === true) this.pits.unshift({ number: row.number, type: "out", time: now, lap: row.laps });
        if (old.driver && row.driver && old.driver.id !== row.driver.id) this.drivers.unshift({ number: row.number, from: old.driver.name, to: row.driver.name, time: now });
        if (completed && completed.lap > old.baseline && !laps.some((l) => l.lap === completed.lap)) {
          laps.push({
            lap: completed.lap, time: completed.time, seconds: completed.seconds, source: completed.source, driver: row.driver?.code,
            position: oneLap && Number.isInteger(row.position) && row.position > 0 ? row.position : null,
            classPosition: oneLap && Number.isInteger(row.classPosition) && row.classPosition > 0 ? row.classPosition : null,
            totalTime: completed.lap === row.laps ? row.totalTime : null,
            sectors: completedLapSectors(completed.seconds, sectorLaps.get(completed.lap)),
            mapEligible: oneLap && !old.pitLap && row.inPit === false && old.inPit === false,
            clean: oneLap && !old.dirtyLap && row.inPit === false && old.inPit === false && old.flag === "GREEN" && snapshot.session.flag === "GREEN", observedAt: now,
          });
        }
      }
      this.cars.set(row.number, { laps: laps.slice(-30), completedCount: row.laps, totalSeconds,
        sectorLaps, pitLap: newLap ? row.inPit !== false : Boolean(old?.pitLap || row.inPit !== false),
        baseline: old?.baseline ?? row.laps ?? row.lastLapNumber ?? 0, displayLast: completed,
        inPit: row.inPit, driver: row.driver, flag: snapshot.session.flag,
        dirtyLap: newLap ? unsafe : Boolean(old?.dirtyLap || unsafe) });
    }
    this.pits = this.pits.slice(0, 100); this.drivers = this.drivers.slice(0, 100);
    for (const message of snapshot.messages ?? []) this.messages.set(`${message.time}|${message.text}`, message);
    // COMP_DETAIL exposes a rolling message window; retain messages actually observed in this session.
    this.messages = new Map([...this.messages].slice(-100));
    const messageTime = (message) => message.time?.replace(/^(\d{2})\.(\d{2})\.(\d{4}) /, "$3-$2-$1 ") ?? "";
    snapshot.messages = [...this.messages.values()].sort((a, b) => messageTime(a).localeCompare(messageTime(b)));
    snapshot.history = Object.fromEntries([...this.cars].map(([number, car]) => [number, car.laps]));
    snapshot.pitEvents = [...this.pits]; snapshot.driverEvents = [...this.drivers];
    return snapshot;
  }
}
