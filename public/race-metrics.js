export function averagePace(history = [], requestedWindow = 5) {
  const window = [3, 5, 10].includes(Number(requestedWindow)) ? Number(requestedWindow) : 5;
  const laps = history.filter((lap) => lap.clean === true && Number.isFinite(lap.seconds) && lap.seconds > 0).slice(-window);
  return { laps, window, count: laps.length,
    seconds: laps.length ? laps.reduce((sum, lap) => sum + lap.seconds, 0) / laps.length : null };
}

export function formatLapTime(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "—";
  const ms = Math.round(seconds * 1000);
  return `${Math.floor(ms / 60000)}:${String(Math.floor(ms % 60000 / 1000)).padStart(2, "0")}.${String(ms % 1000).padStart(3, "0")}`;
}

// Swiss Timing publishes sector-based progress, not F1 mini-sector measurements.
export function sectorFill(progress, index) {
  if (!Number.isFinite(progress) || progress < 0 || progress > 3 || !Number.isInteger(index) || index < 0 || index > 2) return null;
  return Math.max(0, Math.min(1, progress - index));
}

const raceSeconds = (value) => typeof value === "string" && /^\d+(?::\d{1,2}){0,2}(?:\.\d+)?$/.test(value) ? value.split(":").reduce((sum, part) => sum * 60 + Number(part), 0) : null;
export function synchronizedGap(row, reference, value) {
  const official = { value, title: "Official timing gap" };
  if (!/^1\s*L$/i.test(value ?? "")) return official;
  const pending = { value: null, title: `Waiting for comparable completed laps; the source currently reports ${value}` };
  if (!reference || !Number.isInteger(row.laps) || row.laps < 1) return pending;
  const ownTime = raceSeconds(row.totalTime), referenceTime = raceSeconds(reference.totalTime), lastLap = raceSeconds(reference.last);
  if (ownTime === null || referenceTime === null || !(lastLap > 0)) return pending;
  const lapDifference = reference.laps - row.laps;
  if (lapDifference > 1) return official;
  let aligned = referenceTime;
  if (lapDifference === 1 && reference.lastLapNumber === reference.laps) aligned -= lastLap;
  else if (lapDifference !== 0) return pending;
  const gap = ownTime - aligned;
  if (gap < -.002) return pending;
  // A caution/pit lap can be much slower than a normal lap. Only replace 1L
  // when the gap is below a measured fastest lap, so genuine lapped cars stay lapped.
  const fastest = [raceSeconds(reference.best), raceSeconds(row.best)].filter((time) => time > 0);
  if (!fastest.length || gap >= Math.min(...fastest) - .002) return official;
  const rounded = Math.max(0, Math.round(gap * 1000)) / 1000;
  const result = rounded < 60 ? rounded.toFixed(3) : `${Math.floor(rounded / 60)}:${(rounded % 60).toFixed(3).padStart(6, "0")}`;
  return { value: result, title: `Gap to #${reference.number} at the same completed lap ${row.laps}. Aligned from measured race times; source: ${value}` };
}
