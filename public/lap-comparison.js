export function lapSeconds(value) {
  if (typeof value !== "string" || !/^\d+(?::\d{1,2}){0,2}(?:\.\d+)?$/.test(value)) return null;
  const total = value.split(":").reduce((sum, part) => sum * 60 + Number(part), 0);
  return total > 0 ? total : null;
}

export function formatDelta(seconds) {
  if (!Number.isFinite(seconds)) return "—";
  const ms = Math.sign(seconds) * Math.round(Math.abs(seconds) * 1000);
  return `${ms < 0 ? "−" : ms > 0 ? "+" : ""}${(Math.abs(ms) / 1000).toFixed(3)}`;
}

export const deltaWinner = (delta) => !Number.isFinite(delta) || Math.round(Math.abs(delta) * 1000) === 0 ? null : delta < 0 ? "a" : "b";

function completedLaps(row, history) {
  const laps = new Map();
  for (const entry of history) {
    const seconds = lapSeconds(entry.time);
    if (Number.isInteger(entry.lap) && entry.lap > 0 && seconds !== null) laps.set(entry.lap, { ...entry, seconds });
  }
  // The feed's last completed lap remains useful even before local observation history starts.
  // Its caution/pit history is unknown, so it cannot be used in clean pace.
  if (Number.isInteger(row?.lastLapNumber) && row.lastLapNumber > 0 && !laps.has(row.lastLapNumber)) {
    const seconds = lapSeconds(row.last);
    if (seconds !== null) laps.set(row.lastLapNumber, { lap: row.lastLapNumber, time: row.last, seconds, clean: null });
  }
  return laps;
}

export function lapPositionChange(current, previous, { withinClass = false } = {}) {
  if (!current || !previous || previous.lap !== current.lap - 1) return null;
  const field = withinClass ? "classPosition" : "position";
  const from = previous[field], to = current[field];
  if (!Number.isInteger(from) || from < 1 || !Number.isInteger(to) || to < 1 || from === to) return null;
  return { from, to, delta: from - to };
}

export function compareLaps(a, b, historyA = [], historyB = [], requestedWindow = 5, options = {}) {
  const window = [3, 5, 10].includes(Number(requestedWindow)) ? Number(requestedWindow) : 5;
  const left = completedLaps(a, historyA), right = completedLaps(b, historyB);
  const numbers = [...new Set([...left.keys(), ...right.keys()])].sort((x, y) => y - x).slice(0, window);
  const laps = numbers.map((lap) => {
    const a = left.get(lap) ?? null, b = right.get(lap) ?? null;
    const delta = a && b ? a.seconds - b.seconds : null;
    return { lap, a, b, delta, winner: deltaWinner(delta), positionA: lapPositionChange(a, left.get(lap - 1), options), positionB: lapPositionChange(b, right.get(lap - 1), options) };
  });
  const paired = laps.filter(({ a, b }) => a?.clean === true && b?.clean === true);
  const paceA = paired.length ? paired.reduce((sum, lap) => sum + lap.a.seconds, 0) / paired.length : null;
  const paceB = paired.length ? paired.reduce((sum, lap) => sum + lap.b.seconds, 0) / paired.length : null;
  const paceDelta = paired.length ? paceA - paceB : null;
  const bestA = lapSeconds(a?.best), bestB = lapSeconds(b?.best);
  const bestDelta = bestA !== null && bestB !== null ? bestA - bestB : null;
  return { window, laps, pairedCount: paired.length, paceA, paceB, paceDelta, paceWinner: deltaWinner(paceDelta), bestDelta,
    hasExcluded: laps.some(({ a, b }) => (a && a.clean !== true) || (b && b.clean !== true)) };
}
