const actions = ["in", "out", "change"];

// Infer a historical driver only where the recorded handovers establish that interval.
export function driverAtEvent(number, timestamp, changes = []) {
  const timeline = changes.filter((event) => String(event.number) === String(number) && Number.isFinite(event.time)).sort((a, b) => a.time - b.time);
  const before = timeline.findLast((event) => event.time <= timestamp);
  const after = timeline.find((event) => event.time > timestamp);
  if (before && after && before.to !== after.from) return null;
  return before?.to ?? null;
}

export function pitTimeline(pits = [], changes = [], rows = []) {
  const crews = new Map(rows.map((row) => [String(row.number), row]));
  const groups = new Map();
  const add = (event, type) => {
    if (!/^\d+$/.test(String(event.number)) || !Number.isFinite(event.time) || event.time <= 0 || !actions.includes(type)) return;
    const number = String(event.number), key = `${number}|${event.time}`;
    let group = groups.get(key);
    if (!group) {
      group = { number, time: event.time, lap: null, team: crews.get(number)?.team ?? null, actions: [], changes: [], driver: null };
      groups.set(key, group);
    }
    if (!group.actions.includes(type)) group.actions.push(type);
    if (Number.isInteger(event.lap) && event.lap >= 0) group.lap = event.lap;
    if (type === "change" && !group.changes.some((change) => change.from === event.from && change.to === event.to)) group.changes.push({ from: event.from ?? null, to: event.to ?? null });
  };
  for (const event of pits) add(event, event.type);
  for (const event of changes) add(event, "change");
  for (const group of groups.values()) {
    group.actions.sort((a, b) => actions.indexOf(a) - actions.indexOf(b));
    if (!group.changes.length) group.driver = driverAtEvent(group.number, group.time, changes);
  }
  return [...groups.values()].sort((a, b) => b.time - a.time || Number(a.number) - Number(b.number));
}
