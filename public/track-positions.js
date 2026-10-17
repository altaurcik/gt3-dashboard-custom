export const circuitCalibration = Object.freeze({
  length: 4653, sectors: [0, 1616.4, 2977.2, 4653],
  finish: [-8.6299791, 37.2298018], start: [-8.6308098, 37.2321164],
  finishOsmNode: 5006070798, startOsmNode: 5006082198,
});
const radians = Math.PI / 180;
export function metres(a, b) {
  const dLat = (b[1] - a[1]) * radians, dLon = (b[0] - a[0]) * radians;
  return 12742000 * Math.asin(Math.sqrt(Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * radians) * Math.cos(b[1] * radians) * Math.sin(dLon / 2) ** 2));
}

export function sectorDistance(progress) {
  if (!Number.isFinite(progress) || progress < 0 || progress > 3) return null;
  if (progress === 3) return circuitCalibration.length;
  const sector = Math.floor(progress), boundaries = circuitCalibration.sectors;
  return boundaries[sector] + (progress - sector) * (boundaries[sector + 1] - boundaries[sector]);
}

export function buildCircuitPath(coordinates) {
  const points = coordinates.map((point) => [...point]);
  if (points[0][0] !== points.at(-1)[0] || points[0][1] !== points.at(-1)[1]) points.push([...points[0]]);
  const cumulative = [0];
  for (let i = 1; i < points.length; i++) cumulative.push(cumulative.at(-1) + metres(points[i - 1], points[i]));
  const length = cumulative.at(-1), cos = Math.cos(circuitCalibration.finish[1] * radians);
  let offset = 0, nearest = Infinity;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i], dx = (b[0] - a[0]) * cos, dy = b[1] - a[1];
    const t = Math.max(0, Math.min(1, (((circuitCalibration.finish[0] - a[0]) * cos) * dx + (circuitCalibration.finish[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
    const projected = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    const error = metres(projected, circuitCalibration.finish);
    if (error < nearest) { nearest = error; offset = cumulative[i - 1] + t * (cumulative[i] - cumulative[i - 1]); }
  }
  if (nearest > 20) throw new Error("Circuit finish line does not match the geometry");
  return { length, finishError: nearest, offset,
    pointAt(distance) {
      const target = ((offset + distance / circuitCalibration.length * length) % length + length) % length;
      let low = 1, high = cumulative.length - 1;
      while (low < high) { const middle = (low + high) >>> 1; if (cumulative[middle] < target) low = middle + 1; else high = middle; }
      const end = low;
      const fraction = (target - cumulative[end - 1]) / (cumulative[end] - cumulative[end - 1] || 1);
      return points[end - 1].map((value, axis) => value + (points[end][axis] - value) * fraction);
    } };
}

export function positionEligible(row) {
  return row.inPit === false && Number.isInteger(row.laps) && row.laps >= 0
    && !(row.status & (4 | 8 | 16)) && sectorDistance(row.progress) !== null;
}

const milliseconds = (value) => typeof value === "string" && /^\d+(?::\d{1,2}){0,2}(?:\.\d+)?$/.test(value)
  ? value.split(":").reduce((sum, part) => sum * 60 + Number(part), 0) * 1000 : null;

// TotalTime anchors each lap on the shared race clock. Only published, completed
// sectors become segments; their distance is replayed over their measured duration.
export function completedSectorSegments(row) {
  const lap = row.sectorLapNumber;
  if (!Number.isInteger(lap) || lap < 1 || ![row.laps, row.laps + 1].includes(lap)) return [];
  const times = [0, 1, 2].map((i) => milliseconds(row.sectors?.[i]?.time));
  const total = milliseconds(row.totalTime) ?? (row.laps === 0 ? 0 : null);
  if (total === null || (lap === row.laps && times.some((time) => !(time > 0)))) return [];
  let start = lap === row.laps ? total - times.reduce((sum, time) => sum + time, 0) : total;
  if (start < -1) return [];
  const segments = [];
  for (let i = 0; i < 3 && times[i] > 0; i++) {
    segments.push({ key: `${lap}:${i}`, start, end: start + times[i],
      from: (lap - 1) * circuitCalibration.length + circuitCalibration.sectors[i],
      to: (lap - 1) * circuitCalibration.length + circuitCalibration.sectors[i + 1] });
    start += times[i];
  }
  return segments;
}

export class TimingPositions {
  constructor() { this.reset(); }
  reset() {
    this.session = null; this.cars = new Map(); this.playhead = null;
    this.clock = null; this.lastFrame = null;
    this.running = false; this.bufferMs = 0; this.targetBufferMs = 0; this.latestEnd = null;
  }
  advance(now) {
    if (this.running && this.lastFrame !== null && this.playhead !== null) {
      const elapsed = Math.max(0, now - this.lastFrame);
      // Grow a buffer without rewinding or stopping all cars if caution sectors
      // become longer. Once filled, replay runs at the measured sector speed.
      const growth = Math.min(Math.max(0, this.targetBufferMs - this.bufferMs), elapsed * .15);
      this.bufferMs += growth; this.playhead += elapsed - growth;
    }
    this.lastFrame = now;
  }
  freeze(now) { this.advance(now); this.running = false; }
  update(snapshot, now, { fresh = true, reduced = false } = {}) {
    if (!snapshot?.raceAvailable) { this.reset(); return; }
    if (snapshot.session.id !== this.session) { this.reset(); this.session = snapshot.session.id; }
    this.advance(now);
    const active = snapshot.session.state === 1 && !snapshot.session.complete;
    const present = new Set();
    let newest = null, longest = 0;
    for (const row of snapshot.rows) {
      if (!positionEligible(row)) continue;
      present.add(row.number);
      const old = this.cars.get(row.number);
      // A pit, skipped lap or timing correction must not connect unrelated laps.
      const validHistory = old && row.laps >= old.row.laps && row.laps <= old.row.laps + 1;
      const segments = new Map(validHistory ? old.segments.map((segment) => [segment.key, segment]) : []);
      const incoming = completedSectorSegments(row);
      const finishTime = milliseconds(row.totalTime);
      if (finishTime !== null) newest = Math.max(newest ?? 0, finishTime);
      for (const segment of incoming) {
        segments.set(segment.key, segment); newest = Math.max(newest ?? 0, segment.end);
      }
      const ordered = [...segments.values()].sort((a, b) => a.start - b.start).slice(-12);
      for (const segment of ordered) {
        longest = Math.max(longest, segment.end - segment.start);
      }
      this.cars.set(row.number, { row, segments: ordered, displayed: validHistory ? old.displayed : undefined, staticDistance: sectorDistance(row.progress) });
    }
    for (const number of this.cars.keys()) if (!present.has(number)) this.cars.delete(number);
    // A TV Sync seek backwards, reconnect or long inactive tab starts a new buffer.
    const seek = newest !== null && this.latestEnd !== null && newest < this.latestEnd - 2000;
    const reconnect = newest !== null && this.latestEnd !== null && newest > this.latestEnd && this.playhead > newest + 20000;
    if (seek || reconnect) {
      for (const state of this.cars.values()) { state.segments = completedSectorSegments(state.row); state.displayed = undefined; }
      this.playhead = null; this.clock = null;
    }
    this.latestEnd = newest;
    this.targetBufferMs = longest + 8000;
    if (active && longest > 0 && newest !== null && this.playhead === null) {
      this.bufferMs = this.targetBufferMs; this.playhead = newest - this.bufferMs;
      this.clock = { time: newest, at: now };
    }
    this.static = snapshot.session.complete || snapshot.session.state >= 2 || reduced;
    this.running = active && fresh && !reduced && !["RED", "UNKNOWN"].includes(snapshot.session.flag);
  }
  positions(now) {
    this.advance(now);
    const result = [];
    for (const state of this.cars.values()) {
      if (this.static) { result.push({ row: state.row, distance: state.staticDistance, age: 0, replaying: false }); continue; }
      const segment = state.segments.find((item) => this.playhead >= item.start && this.playhead <= item.end);
      if (segment) {
        const fraction = (this.playhead - segment.start) / (segment.end - segment.start);
        state.displayed = segment.from + fraction * (segment.to - segment.from);
        result.push({ row: state.row, distance: state.displayed, age: 0, replaying: true });
      } else if (state.displayed !== undefined) {
        // Missing timing is a real buffer underrun, never another invented lap.
        const completed = state.segments.filter((item) => item.end < this.playhead).at(-1);
        if (completed) state.displayed = completed.to;
        result.push({ row: state.row, distance: state.displayed, age: Infinity, replaying: false });
      }
    }
    return result;
  }
  delaySeconds(now) {
    return this.clock && this.playhead !== null ? Math.max(0, (this.clock.time + now - this.clock.at - this.playhead) / 1000) : null;
  }
}
