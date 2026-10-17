import { mkdir, readFile, writeFile } from "node:fs/promises";
import { event, channel } from "./event.mjs";
import { normalize, ObservationHistory } from "./normalize.mjs";
import { selectRace, raceMetadata } from "./session-selection.mjs";
import { SwissPush } from "./swiss-push.mjs";

function waitingSnapshot(race, schedule, now, error = null) {
  const unit = race ?? { Id: event.raceId, Name: "Race", Code: "R", Type: 0, State: 0 };
  const snapshot = normalize({ UnitId: unit.Id, Results: {} }, { UnitId: unit.Id, Competitors: {} }, unit, {
    mode: "race", receivedAt: schedule?.receivedAt ?? null, changedAt: schedule?.changedAt ?? null,
    uid: schedule?.uid ?? null, detailUid: null, sourceUrl: schedule?.url ?? null,
  });
  snapshot.source.connection = error ? "unavailable" : "connected";
  snapshot.source.error = error;
  snapshot.source.scope = "schedule";
  snapshot.coverage.timing = false;
  snapshot.coverage.sectors = false;
  snapshot.raceAvailable = false;
  snapshot.raceState = unit.State;
  snapshot.schedule = [];
  snapshot.checkedAt = now;
  return snapshot;
}

const isSelectedRace = (snapshot, mode) => snapshot?.session?.mode === "race" && snapshot.session.type === 0
  && snapshot.event?.meetingId === event.meetingId
  && (mode === "auto" ? snapshot.selection?.mode === "auto" : snapshot.session.id === event.raceId);

export class TimingProvider {
  constructor({ fetcher = fetch, cacheDir, clock = () => Date.now(), selectionMode = "auto", realtime = false, onSnapshot } = {}) {
    this.selectionMode = selectionMode === "gt3" ? "gt3" : "auto";
    cacheDir ??= new URL(`../.cache/${this.selectionMode}/`, import.meta.url);
    this.fetcher = fetcher; this.cacheDir = cacheDir; this.clock = clock;
    this.cache = new Map(); this.snapshot = null; this.inflight = null;
    this.observations = new ObservationHistory(); this.lastAttempt = 0;
    this.onSnapshot = onSnapshot; this.revisions = new Map(); this.pushTimer = null; this.stopped = false;
    this.push = realtime ? new SwissPush({ clock, onRevision: (notification) => this.onRevision(notification) }) : null;
  }
  onRevision({ channel: name, uid, reconnect = false }) {
    if (name?.startsWith(event.namespace + "|")) {
      const key = name.slice(event.namespace.length + 1);
      if (uid <= (this.revisions.get(key) ?? -1)) return;
      this.revisions.set(key, uid);
    }
    if (this.pushTimer || this.stopped) return;
    this.pushTimer = setTimeout(() => {
      this.pushTimer = null;
      if (reconnect) this.lastAttempt = 0;
      void this.getSnapshot(true);
    }, 80);
    this.pushTimer.unref?.();
  }
  close() { this.stopped = true; clearTimeout(this.pushTimer); this.push?.close(); }
  async getChannel(name, ttl = 0, optional = false) {
    const now = this.clock(), previous = this.cache.get(name);
    const announced = this.revisions.get(name);
    if (previous && now - previous.receivedAt < ttl && !(announced > (previous.uid ?? -1))) return previous.missing ? null : previous;
    const url = `${event.sourceBase}${name}.json?s=${announced ?? previous?.uid ?? "unknown"}&t=${Math.floor(now / 1000)}`;
    const response = await this.fetcher(url, { signal: AbortSignal.timeout(12000), headers: { Accept: "application/json", "Cache-Control": "no-cache" } });
    if (optional && response.status === 404) {
      this.cache.set(name, { missing: true, receivedAt: now });
      return null;
    }
    if (!response.ok) throw new Error(`Swiss Timing HTTP ${response.status}`);
    const json = await response.json();
    if (!json.content?.full || typeof json.uid !== "number") throw new Error("Unexpected Swiss Timing response");
    const entry = { data: json.content.full, uid: json.uid, url, receivedAt: now,
      changedAt: previous?.uid === json.uid ? previous.changedAt : now };
    this.cache.set(name, entry);
    return entry;
  }
  async refresh() {
    const now = this.clock();
    const schedule = await this.getChannel(channel("SCHEDULE", event.meetingId), 15000);
    if (schedule.data.MeetingId?.toLowerCase() !== event.meetingId) throw new Error("Meeting mismatch");
    const selected = selectRace(schedule.data, this.selectionMode, now);
    const race = selected.unit;
    if (!race) throw new Error("Selected race missing from schedule");
    this.push?.setChannels([channel("SCHEDULE", event.meetingId), channel("TIMING", race.Id), channel("COMP_DETAIL", race.Id)].map((name) => `${event.namespace}|${name}`));
    const [raceTiming, raceDetail] = await Promise.all([
      this.getChannel(channel("TIMING", race.Id), race.State === 0 ? 15000 : 2500, true),
      this.getChannel(channel("COMP_DETAIL", race.Id), race.State === 0 ? 15000 : 2500, true),
    ]);
    const useRace = Boolean(raceTiming && raceDetail);
    const snapshot = useRace ? normalize(raceTiming.data, raceDetail.data, race, {
      mode: "race", receivedAt: Math.min(raceTiming.receivedAt, raceDetail.receivedAt),
      changedAt: raceTiming.changedAt, uid: raceTiming.uid, detailUid: raceDetail.uid, sourceUrl: raceTiming.url,
    }) : waitingSnapshot(race, schedule, now);
    snapshot.event = raceMetadata(schedule.data, race);
    snapshot.session.seriesName = snapshot.event.seriesName;
    snapshot.session.competitionId = race.CompetitionId;
    snapshot.selection = { mode: this.selectionMode, reason: selected.reason };
    snapshot.schedule = [{ id: race.Id, name: race.Name, code: race.Code, state: race.State, begin: race.BeginTime, end: race.EndTime }];
    snapshot.raceState = race.State;
    snapshot.raceAvailable = Boolean(useRace);
    snapshot.checkedAt = now;
    snapshot.source.transport = this.push?.connected ? "push + HTTPS" : "HTTP polling";
    snapshot.source.pushReceivedAt = this.push?.lastAt ?? null;
    this.observations.update(snapshot, now);
    this.snapshot = snapshot;
    this.onSnapshot?.(snapshot);
    await mkdir(this.cacheDir, { recursive: true });
    await writeFile(new URL("snapshot.json", this.cacheDir), JSON.stringify(snapshot)).catch(() => {});
    return snapshot;
  }
  async getSnapshot(force = false) {
    const now = this.clock();
    if (this.inflight) return this.inflight;
    if (!force && this.snapshot && now - this.lastAttempt < 4000) return this.snapshot;
    this.lastAttempt = now;
    this.inflight = this.refresh().catch(async (error) => {
      if (!this.snapshot) {
        try {
          const cached = JSON.parse(await readFile(new URL("snapshot.json", this.cacheDir), "utf8"));
          if (isSelectedRace(cached, this.selectionMode)) this.snapshot = cached;
        } catch { /* no invented fallback */ }
      }
      if (!isSelectedRace(this.snapshot, this.selectionMode)) {
        const empty = waitingSnapshot(null, null, now, error.message);
        empty.event = { ...event, seriesName: "GT World Challenge Europe · Endurance Cup", isVerstappenRace: true };
        empty.selection = { mode: this.selectionMode, reason: "waiting" };
        return empty;
      }
      this.snapshot = { ...this.snapshot, checkedAt: now,
        source: { ...this.snapshot.source, connection: "stale", error: error.message } };
      this.onSnapshot?.(this.snapshot);
      return this.snapshot;
    }).finally(() => { this.inflight = null; });
    return this.inflight;
  }
}
