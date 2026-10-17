import { averagePace, formatLapTime, sectorFill } from "./race-metrics.js";
import { comparisonSelection, resolveComparison, chooseComparisonSide } from "./comparison-selection.js";
import { createTrackMap } from "./track-map.js";
import { newestRaceMessages, raceEventStyle } from "./race-control.js";
import { compareLaps, formatDelta, deltaWinner } from "./lap-comparison.js";
import { classSnapshot, classComparison, matchesClass } from "./class-filter.js";
import { pitTimeline } from "./pit-events.js";

const $ = (selector) => document.querySelector(selector);
const escape = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const dash = (value) => value === null || value === undefined || value === "" ? "—" : escape(value);
const moscowClock = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Moscow", hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
const paths = {
  layout: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M12 4v16M3 9h18"/>',
  monitor: '<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8m-4-4v4"/>',
  pause: '<path d="M8 5v14M16 5v14"/>', sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v.01"/>', close: '<path d="m6 6 12 12M6 18 18 6"/>',
  star: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3l-5.6 2.9 1.1-6.2L3 9.6l6.2-.9z"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  refresh: '<path d="M20 7v5h-5M4 17v-5h5"/><path d="M6.2 7a7 7 0 0 1 11.6-1L20 9M4 15l2.2 3A7 7 0 0 0 18 17"/>',
  map: '<path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3zm6-3v15m6-12v15"/>',
  expand: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>',
  'location-off': '<path d="m3 3 18 18M8 3a8 8 0 0 1 12 7c0 2-1 4-2 6M5 6a8 8 0 0 0-1 4c0 6 8 12 8 12s2-2 4-4"/>',
  compare: '<path d="M3 7h16m-4-4 4 4-4 4M21 17H5m4-4-4 4 4 4"/>',
  flag: '<path d="M4 22V3m0 1c5-4 9 4 16 0v11c-7 4-11-4-16 0"/>',
  penalty: '<path d="m4 4 16 16M20 4 4 20"/><circle cx="12" cy="12" r="9"/>',
  limits: '<path d="M5 3v18m14-18v18M12 3v4m0 3v4m0 3v4"/>',
  'pit-in': '<path d="M3 12h13m-5-5 5 5-5 5M17 3h4v18h-4"/>',
  'pit-out': '<path d="M21 12H8m5-5-5 5 5 5M7 3H3v18h4"/>',
  arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
  pit: '<path d="M3 20h18M6 20V5h12v15M9 8h6M9 12h6M9 16h6"/>',
  play: '<path d="m8 4 12 8-12 8z"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 11h18m-13 4h2m4 0h2"/>',
  radio: '<path d="M4 8a12 12 0 0 0 0 8m4-6a6 6 0 0 0 0 4m12-6a12 12 0 0 1 0 8m-4-6a6 6 0 0 1 0 4"/><circle cx="12" cy="12" r="1"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a17 17 0 0 1 0 18 17 17 0 0 1 0-18"/>',
  helicopter: '<path d="M3 3h14M10 3v5M5 8h10a4 4 0 0 1 0 8H7l-4-4H1M8 16v4m7-4v4M5 20h14M10 8v8"/>',
  car: '<path d="m5 7 2-4h10l2 4 2 3v8H3v-8zM3 10h18M6 18v3m12-3v3M7 14h.01M17 14h.01"/>',
  driver: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',
  sliders: '<path d="M3 6h8m4 0h6M3 12h2m4 0h12M3 18h12m4 0h2M11 3v6M5 9v6m10 0v6"/>',
  plus: '<path d="M12 4v16M4 12h16"/>',
  minus: '<path d="M4 12h16"/>',
  locate: '<circle cx="12" cy="12" r="6"/><path d="M12 2v4m0 12v4M2 12h4m12 0h4"/>',
};
const icon = (name) => `<svg class="icon" aria-hidden="true" viewBox="0 0 24 24">${paths[name] ?? paths.info}</svg>`;
function icons(root = document) { root.querySelectorAll("[data-icon]").forEach((element) => { element.innerHTML = icon(element.dataset.icon); }); }
icons();
let settings;
try { settings = JSON.parse(localStorage.getItem("gt3-preferences-v1") ?? "{}"); } catch { settings = {}; }
const prefs = { theme: "dark", layout: "side", compact: false, delay: 0, ...settings };
prefs.raceMode = prefs.raceMode === "gt3" ? "gt3" : "auto";
prefs.delay = Math.min(120, Math.max(0, Number(prefs.delay) || 0));
let data = null, latest = null, paused = false, buffering = false, frames = [], selected = ["3", null], view = "timing", filter = "all", query = "", lastTableKey = "", lastColumnsKey = "", toastTimer, fetching = false;
let comparisonChoice = comparisonSelection(prefs.comparison), entries = [], entryOptionsKey = "";
let comparisonScope = null;
let realtime = null, realtimeReady = false;
let lastRaceMessagesKey = null, lastPitEventsKey = null;
const isVerstappenRace = () => data?.event?.isVerstappenRace ?? prefs.raceMode === "gt3";
let scopedBase = null, scopedClass = null, scopedSnapshot = null;
function pageSnapshot() {
  if (scopedBase !== data || scopedClass !== filter) {
    scopedBase = data; scopedClass = filter; scopedSnapshot = classSnapshot(data, filter);
  }
  return scopedSnapshot;
}
function save() { try { localStorage.setItem("gt3-preferences-v1", JSON.stringify(prefs)); } catch { /* storage may be unavailable */ } }
const trackMap = createTrackMap({ preferences: prefs.map, onChange: (value) => { prefs.map = value; save(); }, onSelect: selectComparisonCar });
function applyPreferences() {
  document.documentElement.dataset.theme = prefs.theme === "light" ? "light" : "dark";
  document.body.classList.toggle("compact", Boolean(prefs.compact));
  document.body.classList.toggle("viewport-fit", prefs.layout !== "stacked");
  $("#primary-grid").classList.toggle("stacked", prefs.layout === "stacked");
  $("#theme").setAttribute("aria-label", prefs.theme === "dark" ? "Switch to light theme" : "Switch to dark theme");
  $("#compact").checked = Boolean(prefs.compact);
  $("#delay").value = prefs.delay;
  $("#race-mode").value = prefs.raceMode;
  $("#sync-label").textContent = prefs.delay ? `TV Sync · ${prefs.delay}s` : "TV Sync";
  document.querySelectorAll("[data-layout]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.layout === prefs.layout)));
}
applyPreferences();
function toast(text) {
  $("#toast").textContent = text; $("#toast").hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { $("#toast").hidden = true; }, 4000);
}
function togglePopover(button, target) {
  const opening = $(target).hidden;
  for (const id of ["#layout-menu", "#sync-menu"]) $(id).hidden = true;
  for (const id of ["#layout-button", "#sync-button"]) $(id).setAttribute("aria-expanded", "false");
  $(target).hidden = !opening; $(button).setAttribute("aria-expanded", String(opening));
}
$("#layout-button").addEventListener("click", () => togglePopover("#layout-button", "#layout-menu"));
$("#sync-button").addEventListener("click", () => togglePopover("#sync-button", "#sync-menu"));
document.addEventListener("click", (event) => {
  if (!event.target.closest(".dropdown")) {
    ["#layout-menu", "#sync-menu"].forEach((id) => { $(id).hidden = true; });
    ["#layout-button", "#sync-button"].forEach((id) => $(id).setAttribute("aria-expanded", "false"));
  }
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    for (const [button, menu] of [["#layout-button", "#layout-menu"], ["#sync-button", "#sync-menu"]]) {
      if (!$(menu).hidden) { $(menu).hidden = true; $(button).setAttribute("aria-expanded", "false"); $(button).focus(); }
    }
    if (!$("#sources").hidden) { $("#sources").hidden = true; $("#sources-button").setAttribute("aria-expanded", "false"); $("#sources-button").focus(); }
  }
});
document.querySelectorAll("[data-layout]").forEach((button) => button.addEventListener("click", () => { prefs.layout = button.dataset.layout; save(); applyPreferences(); }));
$("#compact").addEventListener("change", (e) => { prefs.compact = e.target.checked; save(); applyPreferences(); });
$("#theme").addEventListener("click", () => { prefs.theme = prefs.theme === "dark" ? "light" : "dark"; save(); applyPreferences(); });
$("#delay").addEventListener("input", (e) => {
  prefs.delay = Math.min(120, Math.max(0, Number(e.target.value) || 0));
  save(); $("#sync-label").textContent = prefs.delay ? `TV Sync · ${prefs.delay}s` : "TV Sync";
  chooseFrame();
});
$("#delay").addEventListener("change", () => { $("#delay").value = prefs.delay; });
$("#pause").addEventListener("click", () => {
  paused = !paused; $("#pause").setAttribute("aria-pressed", String(paused));
  $("#pause").setAttribute("aria-label", paused ? "Resume timing" : "Pause timing");
  $("#pause").innerHTML = icon(paused ? "play" : "pause");
  trackMap.setPlayback({ paused, delay: prefs.delay });
  if (!paused) chooseFrame(); else renderStatus();
});
function showSources() { $("#sources").hidden = !$("#sources").hidden; $("#sources-button").setAttribute("aria-expanded", String(!$("#sources").hidden)); }
$("#sources-button").addEventListener("click", showSources); $("#footer-sources").addEventListener("click", showSources);
$("#sources-close").addEventListener("click", () => { $("#sources").hidden = true; $("#sources-button").setAttribute("aria-expanded", "false"); $("#sources-button").focus(); });
document.querySelectorAll("[data-view]").forEach((button) => button.addEventListener("click", () => { view = button.dataset.view; document.querySelectorAll("[data-view]").forEach((b) => b.setAttribute("aria-pressed", String(b === button))); renderTable(); }));
$("#search").addEventListener("input", (e) => { query = e.target.value.trim().toLowerCase(); renderTable(); });
$("#timing-head").addEventListener("change", (e) => {
  if (e.target.id !== "class-filter") return;
  filter = e.target.value; render();
});
$("#lap-window").addEventListener("change", () => { renderTable(); renderComparison(); renderFavorite(); });
$("#refresh").addEventListener("click", () => void poll(true));
$("#race-mode").addEventListener("change", (event) => {
  prefs.raceMode = event.target.value; save();
  startRealtime();
  paused = false; buffering = false;
  $("#pause").setAttribute("aria-pressed", "false"); $("#pause").setAttribute("aria-label", "Pause timing"); $("#pause").innerHTML = icon("pause");
  frames = []; data = null; latest = null; comparisonScope = null; query = ""; filter = "all";
  trackMap.setSnapshot(null);
  $("#search").value = ""; lastTableKey = ""; lastColumnsKey = "";
  $("#timing-head").innerHTML = "";
  $("#timing-body").innerHTML = '<tr><td class="table-loading" colspan="11">Loading the selected race…</td></tr>';
  renderStatus(); renderFavorite(); renderComparison(); void poll();
});
function syncComparisonSelection() {
  const gt3 = isVerstappenRace();
  const scope = gt3 ? "gt3" : data?.event?.competitionId ?? "pending";
  if (scope !== comparisonScope) {
    if (comparisonScope && comparisonScope !== "pending") { filter = "all"; query = ""; $("#search").value = ""; }
    comparisonScope = scope;
    comparisonChoice = comparisonSelection(prefs.comparisonScopes?.[scope] ?? (gt3 ? prefs.comparison : { mode: "manual", a: null, b: null }));
    entryOptionsKey = "";
  }
  const rows = pageSnapshot()?.rows ?? [];
  const choice = classComparison(comparisonChoice, rows, filter);
  const resolved = resolveComparison(rows, choice, "3", { withinClass: filter !== "all" });
  selected = [resolved.aNumber, resolved.bNumber];
  return resolved;
}
function setComparison(choice) {
  comparisonChoice = comparisonSelection(choice);
  prefs.comparisonScopes = { ...(prefs.comparisonScopes ?? {}), [comparisonScope]: comparisonChoice };
  if (isVerstappenRace()) prefs.comparison = comparisonChoice;
  save();
  syncComparisonSelection(); trackMap.setSelection(selected); renderTable(); renderComparison(); renderEvents();
}
for (const side of ["a", "b"]) $("#comparison-" + side).addEventListener("change", (event) => {
  setComparison(chooseComparisonSide(syncComparisonSelection(), side, event.target.value));
});
$("#comparison-auto").addEventListener("change", (event) => {
  const current = syncComparisonSelection();
  setComparison(event.target.checked ? { mode: "ahead", a: current.aNumber } : { mode: "manual", a: current.aNumber, b: current.bNumber });
});
$("#favorite").addEventListener("click", () => {
  query = "";
  $("#search").value = "";
  setComparison({ mode: "ahead" });
  const row = document.querySelector('tr[data-car="3"]');
  if (row) { $("#table-scroll").scrollTop = Math.max(0, row.offsetTop - 90); row.querySelector("button").focus({ preventScroll: true }); }
});

const manufacturerColor = (name = "") => ({ Porsche: "#e8bb4c", "Mercedes-AMG": "#64d4c4", "BMW M": "#6b9fff", Ferrari: "#fa707b", Audi: "#b7c1d0", Lamborghini: "#b0d96c", McLaren: "#edab66", "Aston Martin": "#6ac3b1", Ford: "#7ca9e8" })[name] ?? "var(--muted)";
function crewName(row) { return row.driver?.name ?? row.drivers.map((d) => d.lastName).join(" / "); }
function crewMarkup(row) {
  const a = selected.indexOf(row.number);
  const suffix = a >= 0 ? ` · selected ${a === 0 ? "A" : "B"}` : "";
  return `<button class="crew-button" data-select="${escape(row.number)}" aria-label="Compare car ${escape(row.number)}${suffix}" aria-pressed="${a >= 0}"><span class="car-number">${escape(row.number)}</span><i class="manufacturer-mark" style="background:${manufacturerColor(row.manufacturer)}"></i><span class="crew-text"><strong>${escape(crewName(row)) || "Crew unavailable"}</strong><small>${escape(row.team)}</small></span></button>`;
}
const paceFor = (row) => averagePace(data?.history?.[row.number] ?? [], Number($("#lap-window").value));
function sectorMarkup(row) {
  return `<div class="sector-strip">${[0, 1, 2].map((index) => {
    const sector = row.sectors[index];
    const fill = sectorFill(row.progress, index);
    const state = sector?.time ? sector.state ?? 0 : 0;
    return `<div class="sector-unit" data-state="${state}" title="S${index + 1}: ${sector?.time ? escape(sector.time) : "No sector time"}${fill === null ? "" : ` · Source progress ${Math.round(fill * 100)}%`}"><span><small>S${index + 1}</small>${dash(sector?.time)}</span><div class="sector-track">${fill === null ? "" : `<i style="width:${fill * 100}%"></i>`}</div></div>`;
  }).join("")}</div>`;
}
function renderTable() {
  if (!data?.rows) return;
  const lapWindow = Number($("#lap-window").value);
  const key = JSON.stringify([data.session?.id, data.source?.uid, data.source?.detailUid, data.source?.connection, selected, view, filter, query, lapWindow, data.rows.length]);
  if (key === lastTableKey) return; lastTableKey = key;
  const activeElement = document.activeElement?.dataset?.select;
  const columns = view === "stints" ? ["POS", "CREW / TEAM", "CLASS", "LAPS", "PIT", "OBSERVED LAP HISTORY"] : ["POS", "CREW / TEAM", "CLASS", "LAST", "BEST", `PACE · ${lapWindow}L`, "SECTORS", "GAP", "INT", "LAPS", "PIT"];
  const classNames = [...new Set(data.rows.map((row) => row.className).filter(Boolean))].sort();
  if (filter !== "all" && !classNames.includes(filter)) filter = "all";
  const columnsKey = columns.join("|") + classNames.join("|");
  if (lastColumnsKey !== columnsKey) {
    lastColumnsKey = columnsKey;
    const table = $("#timing-head").closest("table");
    const widths = view === "stints" ? [36, 240, 105, 70, 70, 570] : [36, 240, 105, 80, 80, 95, 210, 75, 75, 60, 60];
    let columnGroup = table.querySelector("colgroup");
    if (!columnGroup) { columnGroup = document.createElement("colgroup"); table.insertBefore(columnGroup, $("#timing-head")); }
    columnGroup.innerHTML = widths.map((width) => `<col style="width:${width}px">`).join("");
    $("#timing-head").innerHTML = `<tr>${columns.map((c) => c === "CLASS"
      ? `<th scope="col" class="class-filter-heading"><select id="class-filter" class="column-class-filter" aria-label="Filter by class" title="Filter crews by class"><option value="all">CLASS · All</option>${classNames.map((name) => `<option value="${escape(name)}">${escape(name)}</option>`).join("")}</select></th>`
      : `<th scope="col">${c}</th>`).join("")}</tr>`;
  }
  $("#class-filter").value = filter;
  $("#class-filter").classList.toggle("class-filter-active", filter !== "all");
  const rows = (pageSnapshot()?.rows ?? []).filter((r) => !query || `${r.number} ${r.team} ${r.car} ${r.drivers.map((d) => d.name).join(" ")}`.toLowerCase().includes(query));
  $("#timing-body").innerHTML = rows.length ? rows.map((r) => {
    const status = r.status & 8 ? "DSQ" : r.status & 4 ? "DNF" : r.status & 16 ? "DNS" : null;
    let content = `<td>${status ?? dash(r.position)}</td><td>${crewMarkup(r)}</td><td><span class="class-badge class-${escape(r.className)}">${dash(r.className)}</span></td>`;
    if (view === "stints") {
      const laps = data.history?.[r.number] ?? [];
      content += `<td>${dash(r.laps)}</td><td>${dash(r.pitStops)}</td><td>${laps.length ? `<div class="stint-row">${laps.map((l) => `<span class="${l.clean ? "" : "unclean"}" title="Lap ${l.lap} · ${escape(l.time)} · ${escape(l.driver)}${l.clean ? "" : " · caution or pit lap"}"></span>`).join("")}</div>` : '<span class="muted">Waiting for observed race laps</span>'}</td>`;
    } else {
      const pace = paceFor(r);
      content += `<td title="${r.lastSource === "observed-total-time-delta" ? "Completed lap calculated from two observed cumulative race times" : "Last completed lap from the timing feed"}">${dash(r.last)}</td><td>${dash(r.best)}</td><td class="pace-cell" title="Average of ${pace.count} observed clean race laps"><span>${formatLapTime(pace.seconds)}</span><small>${pace.count} / ${pace.window} laps</small></td><td>${sectorMarkup(r)}</td><td>${status ?? (r.position === 1 ? "LEADER" : dash(r.gap))}</td><td>${dash(r.interval)}</td><td>${dash(r.laps)}</td><td class="${r.inPit ? "pit-in" : ""}">${r.inPit ? "IN " : ""}${dash(r.pitStops)}</td>`;
    }
    return `<tr data-car="${escape(r.number)}" class="${isVerstappenRace() && r.number === "3" ? "favorite " : ""}${selected[0] === r.number ? "selected-a" : selected[1] === r.number ? "selected-b" : ""}">${content}</tr>`;
  }).join("") : `<tr><td class="table-loading" colspan="${columns.length}">${data.rows.length ? "No crews match this filter. Clear the search or select All classes." : `<div class="race-waiting"><strong>Waiting for race timing</strong><span>${escape(data.event?.seriesName ?? "Portimão race weekend")} · ${escape(data.session?.name ?? "Race")}</span><p>Last / best lap, S1–S3 and pace will appear when the official race feed opens.</p></div>`}</td></tr>`;
  $("#table-count").textContent = data.raceAvailable ? `${rows.length} / ${data.rows.length} cars${filter !== "all" ? ` · ${filter}` : ""} · ${data.session.name}` : "Awaiting the official race feed";
  if (activeElement) document.querySelector(`[data-select="${CSS.escape(activeElement)}"]`)?.focus({ preventScroll: true });
}
$("#timing-body").addEventListener("click", (event) => {
  const button = event.target.closest("[data-select]"); if (!button) return;
  selectComparisonCar(button.dataset.select);
});
function selectComparisonCar(number) {
  const current = syncComparisonSelection();
  if (current.aNumber === number) setComparison({ mode: "manual", a: null, b: current.bNumber });
  else if (current.bNumber === number) setComparison({ mode: "manual", a: current.aNumber, b: null });
  else setComparison(chooseComparisonSide(current, current.aNumber ? "b" : "a", number));
}
function renderComparisonControls(current) {
  const gt3 = isVerstappenRace();
  const roster = new Map((gt3 ? entries : []).map((entry) => [entry.number, entry]));
  if (gt3 && !roster.has("3")) roster.set("3", { number: "3", team: "Verstappen Racing", drivers: [] });
  for (const row of data?.rows ?? []) roster.set(row.number, row);
  for (const [number, entry] of roster) if (!matchesClass(entry, filter)) roster.delete(number);
  if (filter === "all") for (const number of selected.filter(Boolean)) if (!roster.has(number)) roster.set(number, { number, team: "Awaiting race entry", drivers: [] });
  const options = [...roster.values()].sort((a, b) => Number(a.number) - Number(b.number)).map((entry) => {
    const names = (entry.drivers ?? []).map((driver) => typeof driver === "string" ? driver : driver.name).join(" / ");
    return `<option value="${escape(entry.number)}" title="${escape(names)}">#${escape(entry.number)} · ${escape(entry.team ?? "Crew")}</option>`;
  }).join("");
  const placeholderB = current.mode === "ahead" ? `Awaiting crew ahead of #${current.aNumber}` : "Select crew B";
  const key = options + placeholderB;
  if (key !== entryOptionsKey) {
    entryOptionsKey = key;
    $("#comparison-a").innerHTML = '<option value="">Select crew A</option>' + options;
    $("#comparison-b").innerHTML = `<option value="">${placeholderB}</option>` + options;
  }
  $("#comparison-a").value = current.aNumber ?? "";
  $("#comparison-b").value = current.bNumber ?? "";
  $("#comparison-auto").checked = current.mode === "ahead";
  $("#comparison-auto").disabled = !current.aNumber;
  for (const side of ["a", "b"]) {
    const row = current[side];
    $("#comparison-label-" + side).textContent = [side.toUpperCase(), row?.driver?.name, row?.position ? `P${row.position}` : null].filter(Boolean).join(" · ");
  }
}
function renderComparison() {
  const current = syncComparisonSelection();
  renderComparisonControls(current);
  $("#lap-window").disabled = false;
  if (!data?.raceAvailable) {
    $("#comparison").innerHTML = '<div class="empty"><strong>Waiting for race laps</strong></div>';
    return;
  }
  const rows = [current.a, current.b];
  if (rows.some((row) => !row)) { $("#comparison").innerHTML = `<div class="empty"><strong>${current.reason === "leader" ? `No crew ahead of #${escape(current.aNumber)}` : current.mode === "ahead" ? "Waiting for race positions" : "Select two crews"}</strong></div>`; return; }
  const [a, b] = rows;
  const result = compareLaps(a, b, pageSnapshot()?.history?.[a.number], pageSnapshot()?.history?.[b.number], Number($("#lap-window").value));
  const winningNumber = result.paceWinner === "a" ? a.number : b.number;
  const verdict = result.pairedCount === 0 ? "Waiting for matched clean laps"
    : result.paceWinner ? `#${winningNumber} faster by ${Math.abs(result.paceDelta).toFixed(3)} s/lap` : "Equal pace";
  const timeCell = (lap, winner, side) => `<td class="${winner === side ? "lap-winner" : ""}" data-side="${side}">${dash(lap?.time)}${lap && lap.clean !== true ? '<sup title="Excluded from average: pit, caution or incomplete observation">†</sup>' : ""}</td>`;
  const deltaCell = (delta) => `<td class="lap-delta ${deltaWinner(delta) ? `winner-${deltaWinner(delta)}` : ""}">${formatDelta(delta)}</td>`;
  $("#comparison").innerHTML = `<div class="comparison-verdict ${result.paceWinner ? `winner-${result.paceWinner}` : ""}"><strong>${escape(verdict)}</strong>${result.pairedCount ? `<span>${result.pairedCount} matched clean lap${result.pairedCount === 1 ? "" : "s"}</span>` : ""}</div>
    <div class="lap-comparison-scroll"><table class="lap-comparison-table"><caption class="sr-only">Same-number race laps. Delta is A minus B in seconds: negative means A is faster, positive means B is faster.</caption>
    <colgroup><col class="lap-label-col"><col><col><col class="lap-delta-col"></colgroup>
    <thead><tr><th scope="col">LAP</th><th scope="col" class="side-a">A</th><th scope="col" class="side-b">B</th><th scope="col" title="A minus B, seconds. Negative: A faster. Positive: B faster.">Δ A−B</th></tr></thead>
    <tbody>${result.laps.length ? result.laps.map((lap) => `<tr><th scope="row">${lap.lap}</th>${timeCell(lap.a, lap.winner, "a")}${timeCell(lap.b, lap.winner, "b")}${deltaCell(lap.delta)}</tr>`).join("") : '<tr><td colspan="4" class="lap-waiting">No completed laps received yet</td></tr>'}</tbody>
    <tfoot><tr class="matched-average"><th scope="row" title="Average over identical clean lap numbers in the selected window">Matched avg</th><td>${formatLapTime(result.paceA)}</td><td>${formatLapTime(result.paceB)}</td>${deltaCell(result.paceDelta)}</tr>
    <tr><th scope="row">Race best</th><td>${dash(a.best)}</td><td>${dash(b.best)}</td>${deltaCell(result.bestDelta)}</tr></tfoot></table></div>
    ${result.hasExcluded ? '<p class="lap-exclusions">† Excluded from pace: pit, caution or incomplete observation.</p>' : ""}`;
}
function renderEvents() {
  const scoped = pageSnapshot();
  const messages = newestRaceMessages(scoped?.messages);
  $("#messages-count").textContent = messages.length;
  const messagesKey = JSON.stringify(messages);
  if (messagesKey !== lastRaceMessagesKey) {
    lastRaceMessagesKey = messagesKey;
    $("#race-control").innerHTML = messages.length ? messages.map((m) => {
    const style = raceEventStyle(m);
    return `<article class="event-item race-event event-${style.tone}" data-tone="${style.tone}"><header><span class="race-event-type">${icon(style.icon)}<b>${style.name}</b></span><time>${dash(m.time)} WEST</time></header><p>${escape(m.text)}</p></article>`;
    }).join("") : `<div class="empty">${icon("flag")}<strong>Waiting for Race Control</strong><p>Official race messages will appear here.</p></div>`;
  }
  const events = pitTimeline(scoped?.pitEvents, scoped?.driverEvents, scoped?.rows);
  $("#pits-count").textContent = events.length;
  const eventsKey = JSON.stringify([events, selected]);
  if (eventsKey !== lastPitEventsKey) {
    const focusedEvent = document.activeElement?.matches(".pit-event-car") ? document.activeElement.closest(".pit-event")?.dataset.eventKey : null;
    lastPitEventsKey = eventsKey;
    const actionNames = { in: "PIT IN", out: "PIT OUT", change: "DRIVER CHANGE" };
    const actionIcons = { in: "pit-in", out: "pit-out", change: "compare" };
    $("#pit-events").innerHTML = events.length ? events.slice(0, 50).map((event) => {
      const sideIndex = selected.indexOf(event.number), side = sideIndex === 0 ? "a" : sideIndex === 1 ? "b" : "";
      return `<article class="pit-event" data-car="${escape(event.number)}" data-event-key="${event.number}|${event.time}" data-side="${side}">
        <header><button class="pit-event-car" data-pit-select="${escape(event.number)}" aria-label="Compare car ${escape(event.number)}" aria-pressed="${sideIndex >= 0}">${side ? `<small>${side.toUpperCase()}</small>` : ""}<b>#${escape(event.number)}</b></button><span class="pit-event-team" title="${escape(event.team)}">${dash(event.team)}</span><time title="Observed locally; not a measured pit-line timestamp">${time(event.time)} MSK</time></header>
        <div class="pit-event-actions">${event.actions.map((action) => `<span class="pit-action pit-action-${action}">${icon(actionIcons[action])}${actionNames[action]}</span>`).join("")}${event.lap !== null ? `<span class="pit-event-lap">LAP ${event.lap}</span>` : ""}</div>
        ${event.changes.map((change) => `<div class="pit-driver-change"><span class="pit-driver-from">${dash(change.from)}</span><span class="sr-only"> to </span>${icon("arrow")}<strong class="pit-driver-to">${dash(change.to)}</strong></div>`).join("")}
        ${event.driver ? `<div class="pit-event-driver">${escape(event.driver)}</div>` : ""}
      </article>`;
    }).join("") : `<div class="empty">${icon("pit")}<strong>No stops observed</strong><p>Race history starts when the official feed opens.</p></div>`;
    if (focusedEvent) document.querySelector(`.pit-event[data-event-key="${focusedEvent}"] .pit-event-car`)?.focus({ preventScroll: true });
  }
}
$("#pit-events").addEventListener("click", (event) => {
  const button = event.target.closest("[data-pit-select]"); if (button) selectComparisonCar(button.dataset.pitSelect);
});
function time(timestamp) { return moscowClock.format(new Date(timestamp)); }
function renderFavorite() {
  const row = pageSnapshot()?.rows?.find((r) => r.number === "3");
  $(".focus-strip").hidden = !isVerstappenRace() || (filter !== "all" && !row);
  $("#favorite-position").textContent = row?.position ? `P${row.position}` : "—";
  $("#favorite-time").textContent = row?.last ?? "—";
  $("#favorite-pace").textContent = row ? formatLapTime(paceFor(row).seconds) : "—";
  $("#favorite-live-driver").textContent = row?.driver ? `Driving: ${row.driver.name}` : "Mercedes-AMG GT3 EVO";
  $("#field-count").innerHTML = `${data?.raceAvailable ? pageSnapshot()?.rows.length ?? 0 : "—"} <small>cars</small>`;
}
function renderStatus() {
  trackMap.setPlayback({ paused, delay: prefs.delay });
  const source = latest?.source, session = data?.session;
  const metadata = data?.event;
  const series = metadata?.seriesName ?? "Portimão race weekend";
  $("#series-label").textContent = metadata?.seriesShortName ?? "PORTIMÃO RACE WEEKEND";
  $("#event-series").textContent = `${series}${filter !== "all" ? ` · ${filter}` : ""}`;
  document.title = `${series} · ${session?.name ?? "Connecting"} · Portimão`;
  $("#track-start").textContent = metadata?.start ? new Date(metadata.start).toLocaleTimeString("en-GB", { timeZone: "Europe/Moscow", hour: "2-digit", minute: "2-digit" }) : "—";
  const duration = metadata?.durationSeconds;
  $("#track-duration").textContent = Number.isFinite(duration) ? `${Math.floor(duration / 3600)}:${String(Math.floor(duration % 3600 / 60)).padStart(2, "0")}:${String(duration % 60).padStart(2, "0")}` : "—";
  $("#track-series").textContent = metadata?.seriesCode ?? "—";
  const stale = source?.connection !== "connected", now = Date.now();
  $("#connection-status").dataset.state = source?.connection ?? "connecting";
  $("#connection-status").innerHTML = `<i></i>${paused ? "Paused" : buffering ? "Buffering" : stale ? "Source unavailable" : !data?.raceAvailable ? "Awaiting race feed" : "Source connected"}`;
  $("#last-update").textContent = source?.receivedAt ? `Last fetched ${time(source.receivedAt)} MSK · ${source.transport ?? "Swiss Timing"}` : "Swiss Timing · SRO";
  $("#source-detail").textContent = source?.url ? `Channel: ${source.url} · Revision ${source.uid} · ${source.transport ?? "HTTP polling"} · Fetched ${time(source.receivedAt)} MSK. This timestamp is retrieval time, not a timing measurement.` : "No verified timing has been received.";
  $("#session-name").textContent = `${session?.name ?? "Race"}${!data?.raceAvailable ? " · Awaiting feed" : session?.complete ? " · Completed" : ""}`;
  const flag = !data?.raceAvailable ? "SCHEDULED" : session?.complete ? "COMPLETED" : session?.flag === "UNKNOWN" ? "AWAITING FLAG" : session?.flag ?? "AWAITING DATA";
  $("#session-flag").textContent = flag; $("#session-flag").dataset.flag = session?.flag ?? "UNKNOWN";
  const banner = $("#connection-banner"); banner.classList.toggle("error", stale && Boolean(latest));
  if (stale && latest) banner.textContent = `Swiss Timing unavailable${source?.error ? ` · ${source.error}` : ""}. ${data?.rows?.length ? "Showing the last received data; it is not live." : "No verified timing data. Retrying automatically."}`;
  else if (paused) banner.textContent = "Timing paused. Resume to return to the current data or your TV Sync delay.";
  else if (buffering) banner.textContent = `Buffering ${prefs.delay}s of TV Sync history. The delayed view will appear when enough data has been received.`;
  else if (!data?.raceAvailable) banner.textContent = `${series} · ${session?.name ?? "Race"} · Waiting for the official race feed. Lap times, S1–S3 and pace will update automatically.`;
  else if (session?.complete) banner.textContent = "Race completed · Official session results. No live timing is currently running.";
  else if (source?.changedAt && now - source.changedAt > 45000) banner.textContent = `No timing revision changes for ${Math.floor((now - source.changedAt) / 1000)}s. Connection is available; source activity is unconfirmed.`;
  else if (session?.state === 0) banner.textContent = "Race feed published · Awaiting the official session start.";
  else if (session) banner.textContent = `Official race feed · ${prefs.delay ? `${prefs.delay}s TV Sync delay · ` : ""}${source?.transport === "push + HTTPS" ? "Push updates" : "5s polling fallback"} · Pit and lap history recorded locally.`;
  updateClock();
}
function updateClock() {
  const start = data?.event?.start, left = start ? new Date(start).getTime() - Date.now() : null;
  const scheduled = start ? new Date(start).toLocaleString("en-GB", { timeZone: "Europe/Moscow", hour: "2-digit", minute: "2-digit", day: "2-digit", month: "short" }) + " MSK" : "AWAITING SCHEDULE";
  const session = data?.session;
  if (data?.raceAvailable && (session?.state > 0 || session?.complete)) {
    $("#clock-label").textContent = session.complete ? "RACE" : "SOURCE · REMAINING";
    $("#race-clock").textContent = session.complete ? "FINISHED" : session.remaining ?? "—";
    $("#clock-detail").textContent = paused ? "PAUSED" : prefs.delay ? `${prefs.delay}s DELAY` : "SWISS TIMING";
  } else if (left > 0) {
    const seconds = Math.ceil(left / 1000), hours = Math.floor(seconds / 3600);
    $("#clock-label").textContent = "START IN";
    $("#race-clock").textContent = `${String(hours).padStart(2, "0")}:${String(Math.floor(seconds % 3600 / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
    $("#clock-detail").textContent = scheduled;
  } else { $("#clock-label").textContent = "RACE FEED"; $("#race-clock").textContent = "AWAITING"; $("#clock-detail").textContent = scheduled; }
}
function render() {
  if (filter !== "all" && data?.rows?.length && !data.rows.some((row) => matchesClass(row, filter))) filter = "all";
  syncComparisonSelection(); trackMap.setSnapshot(pageSnapshot(), { selected }); renderStatus(); renderFavorite(); renderTable(); renderComparison(); renderEvents();
}
function chooseFrame() {
  if (paused) { renderStatus(); return; }
  const target = Date.now() - prefs.delay * 1000;
  const frame = frames.findLast((f) => f.at <= target);
  buffering = !frame && prefs.delay > 0;
  if (frame) { data = frame.data; render(); }
  else { if (!data) { renderFavorite(); renderComparison(); } renderStatus(); }
}
async function poll(manual = false) {
  if (realtimeReady && !manual) return;
  if (fetching) return; fetching = true; $("#refresh").disabled = true;
  const requestedMode = prefs.raceMode;
  try {
    const response = await fetch(`/api/timing?view=${requestedMode}`, { cache: "no-store", signal: AbortSignal.timeout(26000) });
    if (!response.ok) throw new Error(`Local timing API HTTP ${response.status}`);
    const next = await response.json();
    if (requestedMode !== prefs.raceMode) return;
    acceptSnapshot(next); if (manual) toast(next.source.connection === "connected" ? "Official timing refreshed" : "Source unavailable. Retrying automatically.");
  } catch (error) {
    if (requestedMode !== prefs.raceMode) return;
    latest = { ...(latest ?? {}), source: { ...(latest?.source ?? {}), connection: "unavailable", error: error.message } };
    renderStatus();
  } finally { fetching = false; $("#refresh").disabled = false; if (requestedMode !== prefs.raceMode) void poll(); }
}
function acceptSnapshot(next) {
  if (!Array.isArray(next.rows) || !next.source) throw new Error("Invalid timing response");
  if (next.session?.mode !== "race" || next.session.id !== next.event?.raceId || next.selection?.mode !== prefs.raceMode) throw new Error("Waiting for the selected race feed");
  if (latest?.session?.id === next.session.id && next.checkedAt < latest.checkedAt) return;
  if (latest?.session?.id && latest.session.id !== next.session.id) {
    if (!paused) trackMap.setSnapshot(null);
    frames = []; if (!paused) data = null; lastTableKey = "";
    filter = "all"; query = ""; $("#search").value = "";
  }
  latest = next;
  const now = Date.now(); frames.push({ at: now, data: next }); frames = frames.filter((frame) => now - frame.at < 135000);
  chooseFrame();
}
function startRealtime() {
  realtime?.close(); realtimeReady = false;
  if (!window.EventSource) return;
  const requestedMode = prefs.raceMode;
  const stream = new EventSource(`/api/events?view=${requestedMode}`); realtime = stream;
  stream.onopen = () => { if (stream === realtime) realtimeReady = true; };
  stream.onerror = () => { if (stream === realtime) realtimeReady = false; };
  stream.onmessage = (message) => {
    if (stream !== realtime || requestedMode !== prefs.raceMode) return;
    try { acceptSnapshot(JSON.parse(message.data)); } catch { realtimeReady = false; }
  };
}
renderComparison();
void fetch("/entries.json").then((response) => { if (!response.ok) throw new Error("Entry list unavailable"); return response.json(); }).then((manifest) => {
  if (!Array.isArray(manifest.entries) || manifest.eventId !== "7ab0947f-e429-4b00-9f58-cbc78e143fdc") throw new Error("Entry list event mismatch");
  entries = manifest.entries.filter((entry) => /^\d+$/.test(entry.number)); renderComparison();
}).catch(() => { /* Selection still works from the verified race rows when they become available. */ });
void poll();
startRealtime();
const polling = setInterval(() => void poll(), 5000);
const ticking = setInterval(() => { updateClock(); if (prefs.delay && !paused) chooseFrame(); else renderStatus(); }, 1000);
window.addEventListener("pagehide", () => { clearInterval(polling); clearInterval(ticking); clearTimeout(toastTimer); realtime?.close(); trackMap.destroy(); });

