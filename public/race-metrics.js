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
