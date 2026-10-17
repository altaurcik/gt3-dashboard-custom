import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { event } from "../src/event.mjs";

const source = "https://www.gt-world-challenge-europe.com/entry-list/2026/portimao";
const decode = (text) => text.replace(/<[^>]*>/g, " ").replace(/&#(x[\da-f]+|\d+);/gi, (_, n) => String.fromCodePoint(n[0].toLowerCase() === "x" ? parseInt(n.slice(1), 16) : Number(n)))
  .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&apos;|&#039;/g, "'").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
let html;
if (process.argv[2]) html = await readFile(process.argv[2], "utf8");
else {
  const response = await fetch(source, { signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`Entry list HTTP ${response.status}`);
  html = await response.text();
}
if (!html.includes("Portimao Entry List 2026")) throw new Error("Unexpected event entry list");
const entries = [];
for (const [row] of html.matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi)) {
  const cells = [...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((match) => decode(match[1]));
  if (cells.length !== 7 || !/^\d+$/.test(cells[0])) continue;
  entries.push({ number: cells[0], team: cells[1], drivers: cells.slice(2, 5), car: cells[5], className: cells[6] });
}
if (entries.length < 50 || new Set(entries.map((e) => e.number)).size !== entries.length || !entries.some((e) => e.number === "3" && e.drivers.some((d) => /VERSTAPPEN/i.test(d)))) throw new Error("Entry list validation failed");
await writeFile(new URL("../public/entries.json", import.meta.url), JSON.stringify({ eventId: event.raceId, source, retrievedAt: new Date().toISOString(),
  sourceSha256: createHash("sha256").update(html).digest("hex"), entries }, null, 2) + "\n");
console.log(`Saved ${entries.length} official event entries; no qualifying positions or lap times.`);
