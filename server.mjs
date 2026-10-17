import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TimingProvider } from "./src/provider.mjs";

const root = path.resolve(fileURLToPath(new URL("./public/", import.meta.url)));
const subscribers = { auto: new Set(), gt3: new Set() };
function publish(mode, snapshot) {
  const frame = `data: ${JSON.stringify(snapshot)}\n\n`;
  for (const response of subscribers[mode]) if (!response.destroyed) {
    // A slow or abandoned tab reconnects instead of retaining unbounded timing frames.
    if (response.writableLength > 1_000_000) response.destroy(); else response.write(frame);
  }
}
const providers = Object.fromEntries(["auto", "gt3"].map((mode) => [mode, new TimingProvider({ selectionMode: mode,
  realtime: true, onSnapshot: (snapshot) => publish(mode, snapshot) })]));
const host = process.env.HOST || "127.0.0.1";
const port = Number(process.env.PORT || 3001);
const mime = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8", ".geojson": "application/geo+json", ".svg": "image/svg+xml", ".woff2": "font/woff2" };
const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${host}:${port}`);
    if (request.method !== "GET" && request.method !== "HEAD") { response.writeHead(405).end(); return; }
    if (url.pathname === "/api/events") {
      if (request.method !== "GET") { response.writeHead(405).end(); return; }
      const mode = url.searchParams.get("view") === "gt3" ? "gt3" : "auto";
      response.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" });
      response.write("retry: 2000\n\n"); subscribers[mode].add(response);
      const heartbeat = setInterval(() => response.write(": keepalive\n\n"), 15000);
      response.on("close", () => { clearInterval(heartbeat); subscribers[mode].delete(response); });
      const snapshot = await providers[mode].getSnapshot();
      if (!response.destroyed) response.write(`data: ${JSON.stringify(snapshot)}\n\n`);
      return;
    }
    if (url.pathname === "/api/timing" || url.pathname === "/api/health") {
      const selectionMode = url.searchParams.get("view") === "gt3" ? "gt3" : "auto";
      const snapshot = await providers[selectionMode].getSnapshot();
      const data = url.pathname === "/api/health" ? { source: snapshot.source, session: snapshot.session, cars: snapshot.rows.length, checkedAt: snapshot.checkedAt } : snapshot;
      response.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
      response.end(JSON.stringify(data)); return;
    }
    const requested = decodeURIComponent(url.pathname === "/" || url.pathname === "/dashboard" ? "/index.html" : url.pathname);
    const file = path.resolve(root, `.${requested}`);
    if (!file.startsWith(root + path.sep) || !(await stat(file)).isFile()) { response.writeHead(404).end("Not found"); return; }
    response.writeHead(200, { "Content-Type": mime[path.extname(file)] || "application/octet-stream",
      "X-Content-Type-Options": "nosniff", "Referrer-Policy": "strict-origin-when-cross-origin",
      "Cache-Control": file.endsWith(".woff2") ? "public, max-age=86400" : "no-cache" });
    response.end(request.method === "HEAD" ? undefined : await readFile(file));
  } catch (error) { response.writeHead(error.code === "ENOENT" ? 404 : 500).end("Unable to serve request"); }
});
server.listen(port, host, () => {
  console.log(`GT3 Live Timing: http://${host}:${port}/dashboard`);
  void providers.auto.getSnapshot();
});
server.on("error", (error) => { console.error(error.code === "EADDRINUSE" ? `Port ${port} is busy. Set PORT to another value.` : error.message); process.exitCode = 1; });
const poll = setInterval(() => {
  void providers.auto.getSnapshot();
  if (subscribers.gt3.size) void providers.gt3.getSnapshot();
}, 5000);
poll.unref();
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => {
  clearInterval(poll); Object.values(providers).forEach((provider) => provider.close());
  Object.values(subscribers).forEach((responses) => { for (const response of responses) response.end(); }); server.close();
});
