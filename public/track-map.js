const styleUrl = "https://tiles.openfreemap.org/styles/positron";
const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

function smoothLine(points) {
  let result = points.map((p) => [...p]);
  if (result.length > 1 && result[0][0] === result.at(-1)[0] && result[0][1] === result.at(-1)[1]) result.pop();
  for (let pass = 0; pass < 2; pass++) {
    const next = [];
    for (let i = 0; i < result.length; i++) {
      const a = result[i], b = result[(i + 1) % result.length];
      next.push([a[0] * .75 + b[0] * .25, a[1] * .75 + b[1] * .25], [a[0] * .25 + b[0] * .75, a[1] * .25 + b[1] * .75]);
    }
    result = next;
  }
  return [...result, result[0]];
}

function quietStyle(style) {
  const result = structuredClone(style);
  for (const layer of result.layers) {
    layer.metadata = { ...(layer.metadata ?? {}), originalVisibility: layer.layout?.visibility ?? "visible" };
    if (layer.type === "symbol") layer.layout = { ...(layer.layout ?? {}), visibility: "none" };
    if (layer.type === "background") layer.paint = { ...(layer.paint ?? {}), "background-color": "#181818" };
    if (layer.type === "fill") layer.paint = { ...(layer.paint ?? {}), "fill-color": /water/.test(layer.id) ? "#1b1b1b" : "#252525", "fill-outline-color": "#2d2d2d" };
    if (layer.type === "line") layer.paint = { ...(layer.paint ?? {}), "line-color": "#4b4b4b", "line-opacity": .3 };
  }
  return result;
}

export function createTrackMap({ preferences = {}, onChange = () => {}, onSelect = () => {} } = {}) {
  const $ = (selector) => document.querySelector(selector);
  const panel = $(".track-panel"), viewport = $("#map-viewport"), mapContainer = $("#geographic-map"), svg = $("#track-map");
  const state = { mode: preferences.mode === "2d" ? "2d" : "3d", view: preferences.view === "top" ? "top" : "global",
    buildings: preferences.buildings !== false, labels: Boolean(preferences.labels),
    lighting: ["realtime", "day", "sunset", "night"].includes(preferences.lighting) ? preferences.lighting : "realtime" };
  let geometry, bounds, map, ready = false, loadingMap = null, generation = 0, zoom2d = 1, snapshot = null, expanded = false, priorOverflow = "", resizeFrame = 0, disposed = false;
  const events = new AbortController();
  const positions = new TimingPositions(), markers = new Map();
  const markerLayer = document.createElement("div"); markerLayer.className = "map-car-layer";
  const pitStatus = document.createElement("span"); pitStatus.className = "map-pit-status"; pitStatus.hidden = true;
  viewport.append(markerLayer, pitStatus);
  let circuitPath = null, project2d = null, selected = [], paused = false, delay = 0, positionFrame = 0, frozenForStale = false;
  let projectionDirty = true, projectionBox = null, projectionMatrix = null;
  let metricsAt = 0, metricsFrames = 0, metricsCost = 0, metricsPeak = 0;
  let appliedLighting = null;
  const listen = (target, type, callback, options = {}) => target.addEventListener(type, callback, { ...options, signal: events.signal });
  listen(markerLayer, "click", (event) => {
    const target = event.target.closest(".map-car-dot");
    if (!target) return;
    let number = target.dataset.car;
    if (event.detail > 0) {
      let nearest = Infinity;
      for (const [candidate, marker] of markers) {
        const rect = marker.getBoundingClientRect();
        const distance = Math.hypot(event.clientX - rect.x - rect.width / 2, event.clientY - rect.y - rect.height / 2);
        if (distance < nearest) { nearest = distance; number = candidate; }
      }
    }
    onSelect(number);
  });
  const save = () => onChange({ ...state });
  const duration = () => reducedMotion() ? 0 : 350;
  const trackColor = () => ({ RED: "#ef4444", YELLOW: "#eab308", "SAFETY CAR": "#fb923c", FCY: "#eab308" })[snapshot?.session?.flag] ?? "#f1f5f9";
  const freshPositions = () => snapshot?.source?.connection === "connected" && Date.now() - delay * 1000 - (snapshot?.source?.changedAt ?? 0) < positions.freshnessMs();

  function drawPositions(now = performance.now()) {
    if (disposed) return;
    const fresh = freshPositions();
    if (!fresh && !paused && !frozenForStale) { positions.freeze(now); frozenForStale = true; }
    const list = positions.positions(now), visible = new Set();
    if (projectionDirty || !projectionBox) {
      projectionBox = viewport.getBoundingClientRect(); projectionMatrix = state.mode === "2d" ? svg.getScreenCTM() : null; projectionDirty = false;
    }
    const box = projectionBox, matrix = projectionMatrix;
    for (const item of list) {
      if (!circuitPath) continue;
      const coordinates = circuitPath.pointAt(item.distance);
      let point;
      if (state.mode === "3d" && ready && map) point = map.project(coordinates);
      else if (state.mode === "2d" && project2d && matrix) {
        const [x, y] = project2d(coordinates), screen = new DOMPoint(x, y).matrixTransform(matrix);
        point = { x: screen.x - box.left, y: screen.y - box.top };
      }
      if (!point || point.x < 0 || point.x > box.width || point.y < 0 || point.y > box.height) continue;
      const row = item.row; visible.add(row.number);
      let marker = markers.get(row.number);
      if (!marker) {
        marker = document.createElement("button"); marker.type = "button"; marker.className = "map-car-dot";
        marker.dataset.car = row.number;
        const label = document.createElement("span"); label.className = "map-car-label"; label.textContent = row.number; marker.append(label);
        markerLayer.append(marker); markers.set(row.number, marker);
      }
      marker.hidden = false;
      const side = selected.indexOf(row.number);
      const sideName = side === 0 ? "a" : side === 1 ? "b" : "";
      if (marker.dataset.side !== sideName) marker.dataset.side = sideName;
      marker.classList.toggle("is-favorite", Boolean(snapshot?.event?.isVerstappenRace && row.number === "3"));
      marker.classList.toggle("is-stale", !paused && (!fresh || item.age > 15000));
      const transform = `translate3d(${point.x.toFixed(2)}px,${point.y.toFixed(2)}px,0)`;
      if (marker.style.transform !== transform) marker.style.transform = transform;
      const name = row.driver?.name ?? row.team ?? "Crew";
      const text = `#${row.number} · ${name}${row.position ? ` · P${row.position}` : ""} · Estimated${item.replaying ? " · delayed sector replay" : ""}${!fresh && !paused ? " · stale data" : ""}`;
      if (marker.title !== text) { marker.title = text; marker.setAttribute("aria-label", `${text}. Select for lap comparison.`); }
    }
    for (const [number, marker] of markers) if (!visible.has(number)) { marker.remove(); markers.delete(number); }
    const status = $("#map-position-status");
    const replayDelay = positions.delaySeconds(now);
    const replayText = list.some((item) => item.replaying) ? `Sector replay · ~${Math.ceil(replayDelay ?? 0)}s delay${list.some((item) => !item.replaying) ? " · buffering" : ""}`
      : list.length ? `Estimated · ${list.length} cars · buffering sectors` : "Buffering completed sectors…";
    const text = !snapshot?.raceAvailable ? "Waiting for race positions" : !circuitPath ? "Calibrating timing positions…"
      : snapshot.session.state === 0 ? "Waiting for race sectors" : paused ? `Estimated · ${list.length} cars · PAUSED`
      : snapshot.session.complete ? "Estimated · race finished" : !fresh ? "Estimated · data stale"
      : reducedMotion() ? `Estimated · ${list.length} cars` : replayText;
    const statusState = !snapshot?.raceAvailable ? "pending" : paused ? "paused" : !fresh ? "stale" : "estimated";
    if (status.dataset.state !== statusState) status.dataset.state = statusState;
    if (status.lastChild.textContent !== text) status.lastChild.textContent = text;
    if (!status.title) status.title = "Estimated, not GPS. Completed sectors are replayed over their measured times on a shared race clock, about one measured sector behind. Only the latest normal sector times set the delay; isolated pit/formation outliers and old history do not. No delivery reserve is added. Missing sectors may require buffering; reported positions remain visible.";
    const pits = snapshot?.rows?.filter((row) => row.inPit === true).map((row) => `#${row.number}`) ?? [];
    pitStatus.hidden = !pits.length;
    const pitText = `PIT · ${pits.slice(0, 5).join(" ")}${pits.length > 5 ? ` +${pits.length - 5}` : ""}`;
    if (pitStatus.textContent !== pitText) pitStatus.textContent = pitText;
    const pitTitle = pits.join(" · "); if (pitStatus.title !== pitTitle) pitStatus.title = pitTitle;
  }
  function animatePositions(now) {
    if (disposed) return;
    if (!document.hidden) {
      const began = performance.now(); drawPositions(now); const cost = performance.now() - began;
      metricsFrames++; metricsCost += cost; metricsPeak = Math.max(metricsPeak, cost);
      if (!metricsAt) metricsAt = now;
      if (now - metricsAt >= 1000) {
        markerLayer.dataset.fps = (metricsFrames * 1000 / (now - metricsAt)).toFixed(1);
        markerLayer.dataset.drawMs = (metricsCost / metricsFrames).toFixed(2); markerLayer.dataset.maxDrawMs = metricsPeak.toFixed(2);
        metricsAt = now; metricsFrames = 0; metricsCost = 0; metricsPeak = 0;
      }
    } else { metricsAt = 0; metricsFrames = 0; metricsCost = 0; metricsPeak = 0; }
    positionFrame = requestAnimationFrame(animatePositions);
  }
  positionFrame = requestAnimationFrame(animatePositions);

  function updateControls() {
    projectionDirty = true;
    document.querySelectorAll("[data-map-mode]").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.mapMode === state.mode)));
    document.querySelectorAll("[data-map-view]").forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.mapView === state.view)); button.disabled = state.mode !== "3d";
    });
    $("#map-buildings").checked = state.buildings;
    $("#map-buildings").disabled = state.mode !== "3d";
    $("#map-labels").checked = state.labels;
    $("#map-labels").disabled = state.mode !== "3d";
    $("#map-lighting").value = state.lighting;
    $("#map-lighting").disabled = state.mode !== "3d";
    viewport.classList.toggle("is-2d", state.mode === "2d");
    $(".map-views").hidden = state.mode !== "3d";
    const viewLabels = document.querySelectorAll(".map-control-label");
    if (viewLabels[1]) viewLabels[1].hidden = state.mode !== "3d";
    mapContainer.hidden = state.mode !== "3d";
    svg.toggleAttribute("hidden", state.mode === "3d");
  }

  function setError(message) {
    $("#map-error").hidden = !message;
    if (message) $("#map-error strong").textContent = message;
  }

  function draw2d() {
    if (!geometry) return;
    projectionDirty = true;
    const coordinates = smoothLine(geometry.features[0].geometry.coordinates), origin = coordinates[0], cos = Math.cos(origin[1] * Math.PI / 180);
    const projected = coordinates.map(([lon, lat]) => [(lon - origin[0]) * cos, -(lat - origin[1])]);
    const xs = projected.map((p) => p[0]), ys = projected.map((p) => p[1]);
    const minX = Math.min(...xs), minY = Math.min(...ys), width = Math.max(...xs) - minX, height = Math.max(...ys) - minY;
    const scale = Math.min(440 / width, 285 / height) * zoom2d;
    project2d = ([lon, lat]) => [320 + ((lon - origin[0]) * cos - minX - width / 2) * scale, 240 + (-(lat - origin[1]) - minY - height / 2) * scale];
    const points = projected.map(([x, y]) => [320 + (x - minX - width / 2) * scale, 240 + (y - minY - height / 2) * scale]);
    const path = points.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(2)},${p[1].toFixed(2)}`).join(" ");
    $("#track-lines").innerHTML = `<path class="track-shadow" d="${path}" style="stroke:${trackColor()};stroke-width:13"/><path class="track-line" d="${path}" style="stroke:#3f4148;stroke-width:9"/>`;
    svg.setAttribute("aria-label", "Portimão circuit with positions estimated from sector timing. Not GPS.");
  }

  function fit(animate = true) {
    zoom2d = 1; draw2d();
    if (map && bounds) {
      map.resize();
      const padding = Math.min(42, Math.max(8, (viewport.clientHeight - 140) / 4));
      map.fitBounds(bounds, { padding,
        pitch: state.view === "top" ? 0 : 48, bearing: state.view === "top" ? 0 : -20,
        duration: animate ? duration() : 0, maxZoom: 17 });
    }
  }

  function lighting() {
    let light = state.lighting;
    if (light === "realtime") {
      const hour = Number(new Date().toLocaleTimeString("en-GB", { timeZone: "Europe/Lisbon", hour: "2-digit", hour12: false }));
      light = hour < 6 || hour >= 20 ? "night" : hour >= 18 ? "sunset" : "day";
    }
    return light;
  }

  function applyMapSettings() {
    if (!map || !ready) return;
    if (map.getLayer("circuit-buildings")) map.setLayoutProperty("circuit-buildings", "visibility", state.buildings ? "visible" : "none");
    for (const layer of map.getStyle().layers) if (layer.type === "symbol") {
      map.setLayoutProperty(layer.id, "visibility", state.labels ? layer.metadata?.originalVisibility ?? "visible" : "none");
      if (layer.layout?.["text-field"]) {
        map.setPaintProperty(layer.id, "text-color", "#b8b8b8");
        map.setPaintProperty(layer.id, "text-halo-color", "#181818");
        map.setPaintProperty(layer.id, "text-halo-width", 1);
      }
    }
    const light = lighting();
    appliedLighting = light;
    map.setLight({ anchor: "map", color: light === "sunset" ? "#ffe1bf" : "#ffffff",
      intensity: light === "night" ? .12 : light === "sunset" ? .18 : .24,
      position: [1.2, light === "sunset" ? 235 : 210, light === "sunset" ? 75 : 40] });
    if (map.getLayer("circuit-edge")) map.setPaintProperty("circuit-edge", "line-color", trackColor());
  }

  async function ensure3d() {
    if (disposed || !geometry || state.mode !== "3d") return;
    if (map) { map.resize(); return; }
    if (loadingMap) return loadingMap;
    const currentGeneration = ++generation;
    $("#map-loading").hidden = false;
    setError("");
    loadingMap = (async () => {
      const library = window.maplibregl;
      if (!library) throw new Error("Map renderer could not load");
      library.setWorkerUrl("/vendor/maplibre/maplibre-gl-csp-worker.js");
      library.setWorkerCount(2);
      const response = await fetch(styleUrl, { signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error("Geographic basemap unavailable");
      const style = quietStyle(await response.json());
      if (disposed || currentGeneration !== generation) return;
      map = new library.Map({ container: mapContainer, style, center: [(bounds[0][0] + bounds[1][0]) / 2, (bounds[0][1] + bounds[1][1]) / 2],
        zoom: 14.5, pitch: state.view === "top" ? 0 : 48, bearing: state.view === "top" ? 0 : -20,
        maxPitch: 85, minZoom: 11, maxZoom: 20, attributionControl: { compact: true },
        canvasContextAttributes: { antialias: true } });
      map.getCanvas().setAttribute("aria-label", "Circuit map. Arrow keys pan; plus and minus zoom. Shift and arrow keys rotate or tilt.");
      map.scrollZoom.disable();
      listen(map.getCanvas(), "wheel", (event) => {
        if (!event.ctrlKey || state.mode !== "3d") return;
        event.preventDefault(); map.zoomTo(Math.max(11, Math.min(20, map.getZoom() - event.deltaY * .003)), { duration: 0 });
      }, { passive: false });
      map.on("style.load", () => {
        if (disposed || currentGeneration !== generation) return;
        const line = { type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: smoothLine(geometry.features[0].geometry.coordinates) } }] };
        map.addSource("circuit", { type: "geojson", data: line });
        map.addLayer({ id: "circuit-edge", type: "line", source: "circuit", layout: { "line-cap": "round", "line-join": "round" },
          paint: { "line-color": trackColor(), "line-width": ["interpolate", ["exponential", 2], ["zoom"], 12, 3, 16, 15, 20, 200] } });
        map.addLayer({ id: "circuit-road", type: "line", source: "circuit", layout: { "line-cap": "round", "line-join": "round" },
          paint: { "line-color": "#3f4148", "line-width": ["interpolate", ["exponential", 2], ["zoom"], 12, 1, 16, 10, 20, 150] } });
        const building = style.layers.find((layer) => layer["source-layer"] === "building");
        if (building?.source) map.addLayer({ id: "circuit-buildings", type: "fill-extrusion", source: building.source, "source-layer": "building", minzoom: 13,
          paint: { "fill-extrusion-color": "#383838", "fill-extrusion-height": ["coalesce", ["get", "render_height"], ["get", "height"], 6],
            "fill-extrusion-base": ["coalesce", ["get", "render_min_height"], 0], "fill-extrusion-opacity": .75, "fill-extrusion-vertical-gradient": false } });
        ready = true;
        viewport.classList.add("geographic-map-ready");
        applyMapSettings(); fit(false);
        $("#map-loading").hidden = true;
      });
      map.on("error", (event) => {
        if (disposed || currentGeneration !== generation) return;
        if (/fetch|network|http|tile/i.test(event.error?.message ?? "")) {
          setError("Some geographic map tiles are unavailable");
          $("#map-loading").hidden = true;
        }
      });
      map.on("webglcontextlost", () => { setError("The map graphics context was lost"); });
    })().catch((error) => {
      if (disposed || currentGeneration !== generation) return;
      if (map) { map.remove(); map = null; }
      ready = false; state.mode = "2d"; updateControls(); draw2d();
      setError(error.message); $("#map-loading").hidden = true;
    }).finally(() => { loadingMap = null; });
    return loadingMap;
  }

  function setMode(mode) {
    state.mode = mode; updateControls();
    if (mode === "3d") { void ensure3d().then(() => fit(false)); }
    else { $("#map-loading").hidden = true; draw2d(); }
    save();
  }
  function setExpanded(value) {
    expanded = value;
    panel.classList.toggle("map-expanded", value);
    $("#map-expand").setAttribute("aria-pressed", String(value));
    $("#map-expand").setAttribute("aria-label", value ? "Exit expanded track map" : "Expand track map");
    if (value) { priorOverflow = document.body.style.overflow; document.body.style.overflow = "hidden"; }
    else document.body.style.overflow = priorOverflow;
    requestAnimationFrame(() => fit(false));
  }
  const settingsOpen = (open) => { $("#map-settings").hidden = !open; $("#map-settings-button").setAttribute("aria-expanded", String(open)); };
  document.querySelectorAll("[data-map-mode]").forEach((button) => listen(button, "click", () => setMode(button.dataset.mapMode)));
  document.querySelectorAll("[data-map-view]").forEach((button) => listen(button, "click", () => { state.view = button.dataset.mapView; updateControls(); fit(); save(); }));
  listen($("#map-settings-button"), "click", () => settingsOpen($("#map-settings").hidden));
  listen($("#map-settings-close"), "click", () => { settingsOpen(false); $("#map-settings-button").focus(); });
  listen($("#map-buildings"), "change", (event) => { state.buildings = event.target.checked; applyMapSettings(); save(); });
  listen($("#map-labels"), "change", (event) => { state.labels = event.target.checked; applyMapSettings(); save(); });
  listen($("#map-lighting"), "change", (event) => { state.lighting = event.target.value; applyMapSettings(); save(); });
  listen($("#map-fit"), "click", () => fit());
  for (const [id, delta] of [["#map-zoom-in", 1], ["#map-zoom-out", -1]]) listen($(id), "click", () => {
    if (state.mode === "3d" && map) map.zoomTo(Math.max(11, Math.min(20, map.getZoom() + delta * .5)), { duration: duration() });
    else { zoom2d = Math.max(.4, Math.min(5, zoom2d * (delta > 0 ? 1.25 : .8))); draw2d(); }
  });
  listen(svg, "wheel", (event) => { if (!event.ctrlKey) return; event.preventDefault(); zoom2d = Math.max(.4, Math.min(5, zoom2d - event.deltaY * .002)); draw2d(); }, { passive: false });
  listen($("#map-expand"), "click", () => setExpanded(!expanded));
  listen($("#map-retry"), "click", () => { generation++; if (map) map.remove(); map = null; ready = false; loadingMap = null; setMode("3d"); });
  listen(document, "keydown", (event) => {
    if (event.key !== "Escape") return;
    if (!$("#map-settings").hidden) { settingsOpen(false); $("#map-settings-button").focus(); }
    else if (expanded) { setExpanded(false); $("#map-expand").focus(); }
  });
  const resize = new ResizeObserver(() => {
    projectionDirty = true;
    cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(() => { if (map && mapContainer.clientWidth > 0 && mapContainer.clientHeight > 0) fit(false); });
  });
  resize.observe(viewport);
  updateControls();
  void fetch("/assets/portimao.geojson").then((response) => {
    if (!response.ok) throw new Error("Circuit geometry unavailable"); return response.json();
  }).then((value) => {
    if (disposed) return;
    const coordinates = value.features?.[0]?.geometry?.coordinates;
    if (!Array.isArray(coordinates) || coordinates.length < 4) throw new Error("Invalid circuit geometry");
    geometry = value;
    circuitPath = buildCircuitPath(smoothLine(coordinates));
    bounds = [[Math.min(...coordinates.map((p) => p[0])), Math.min(...coordinates.map((p) => p[1]))], [Math.max(...coordinates.map((p) => p[0])), Math.max(...coordinates.map((p) => p[1]))]];
    draw2d(); if (state.mode === "3d") void ensure3d(); else $("#map-loading").hidden = true;
  }).catch((error) => { setError(error.message); $("#map-loading").hidden = true; });

  return {
    setSnapshot(value, { selected: chosen = selected } = {}) {
      const flagChanged = value?.session?.flag !== snapshot?.session?.flag;
      snapshot = value;
      selected = chosen;
      positions.update(value, performance.now(), { fresh: freshPositions(), reduced: reducedMotion() || paused });
      frozenForStale = !freshPositions();
      if (flagChanged) {
        if (map && ready && map.getLayer("circuit-edge")) map.setPaintProperty("circuit-edge", "line-color", trackColor());
        if (state.mode === "2d") draw2d();
      }
      if (ready && state.lighting === "realtime" && lighting() !== appliedLighting) applyMapSettings();
      drawPositions();
    },
    setSelection(value) { selected = value; drawPositions(); },
    setPlayback(value) {
      if (paused === value.paused && delay === (value.delay ?? 0)) return;
      if (value.paused && !paused) positions.freeze(performance.now());
      paused = value.paused; delay = value.delay ?? 0; drawPositions();
    },
    destroy() { disposed = true; events.abort(); resize.disconnect(); cancelAnimationFrame(resizeFrame); cancelAnimationFrame(positionFrame); markerLayer.remove(); pitStatus.remove(); if (expanded) document.body.style.overflow = priorOverflow; if (map) map.remove(); },
  };
}
import { buildCircuitPath, TimingPositions } from "./track-positions.js";

