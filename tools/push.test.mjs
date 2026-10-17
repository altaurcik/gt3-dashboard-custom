import test from "node:test";
import assert from "node:assert/strict";
import { decodeNotification, SwissPush } from "../src/swiss-push.mjs";
import { TimingProvider } from "../src/provider.mjs";
import { channel, event } from "../src/event.mjs";

const timing = `${event.namespace}|${channel("TIMING", event.raceId)}`;
const envelope = (data, compressed = false) => {
  const header = JSON.stringify({ compressor: compressed ? "lzw" : undefined, format: "json", type: "data" });
  let body = JSON.stringify(data);
  if (compressed) {
    // Independent fixture encoder: compressed percent-encoded JSON, matching the wire format.
    const input = encodeURIComponent(body), dictionary = new Map(); let next = 256, word = "", output = [];
    for (const char of input) {
      if (!word || dictionary.has(word + char)) word += char;
      else { output.push(word.length === 1 ? word.charCodeAt(0) : dictionary.get(word)); dictionary.set(word + char, next++); word = char; }
    }
    if (word) output.push(word.length === 1 ? word.charCodeAt(0) : dictionary.get(word));
    body = String.fromCharCode(...output);
  }
  return String(header.length).padStart(10, "0") + header + body;
};
test("plain and LZW Swiss Timing notifications decode only channel/revision, never merge unverified patches", () => {
  const data = { code: "data", Channel: timing, sync: 359, pushData: { Results: { car: { MainResult: { SectBasedPcntPos: 1.4 } } } } };
  for (const compressed of [false, true]) assert.deepEqual(decodeNotification(envelope(data, compressed)), { channel: timing, uid: 359 });
  assert.equal(decodeNotification(envelope({ ...data, code: "cmd" })), null);
  assert.equal(decodeNotification(envelope({ ...data, sync: "359" })), null);
  assert.throws(() => decodeNotification("broken"));
  assert.throws(() => decodeNotification('0000000050{"compressor":"unknown"}'));
});

class FakeSocket extends EventTarget {
  sent = []; closed = false;
  send(packet) { this.sent.push(packet); }
  close() { this.closed = true; this.dispatchEvent(new Event("close")); }
  receive(packet) { this.dispatchEvent(new MessageEvent("message", { data: packet })); }
}
test("public push handshake, ping, subscriptions and session changes stay read-only and isolated", () => {
  const socket = new FakeSocket(), seen = [];
  const push = new SwissPush({ socketFactory: () => socket, onRevision: (data) => seen.push(data), clock: () => 1234 });
  push.setChannels([timing]);
  socket.receive('0{"pingInterval":20000}'); assert.equal(socket.sent[0], "40");
  socket.receive('40{"sid":"fixture"}');
  assert.equal(push.connected, true); assert.ok(socket.sent[1].includes('"join"'));
  socket.receive("2"); assert.equal(socket.sent.at(-1), "3");
  socket.receive("42" + JSON.stringify(["message", envelope({ code: "data", Channel: timing, sync: 10 }, true)]));
  assert.equal(seen.at(-1).uid, 10); assert.equal(push.lastAt, 1234);
  const count = seen.length;
  push.setChannels(["RAC_PROD|OTHER_RACE"]);
  assert.ok(socket.sent.some((packet) => packet.includes('"leave"')));
  socket.receive("42" + JSON.stringify(["message", envelope({ code: "data", Channel: timing, sync: 11 })]));
  assert.equal(seen.length, count);
  assert.ok(socket.sent.every((packet) => !/upload|auth|delete/i.test(packet)));
  push.close(); assert.equal(socket.closed, true); assert.equal(push.connected, false);
});

test("announced revision bypasses an otherwise fresh HTTP TTL and requests that revision", async () => {
  const requests = [];
  const provider = new TimingProvider({ clock: () => 1000, fetcher: async (url) => {
    requests.push(url); return Response.json({ uid: requests.length === 1 ? 7 : 8, content: { full: {} } });
  } });
  const name = channel("TIMING", event.raceId);
  await provider.getChannel(name, 2500);
  await provider.getChannel(name, 2500); assert.equal(requests.length, 1);
  provider.onRevision({ channel: `${event.namespace}|${name}`, uid: 8 }); provider.close();
  const next = await provider.getChannel(name, 2500);
  assert.equal(requests.length, 2); assert.equal(next.uid, 8);
  assert.equal(new URL(requests[1]).searchParams.get("s"), "8");
});
