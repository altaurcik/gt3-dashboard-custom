// Read-only Engine.IO 4 / Socket.IO notification subset used by the public SRO client.
// Notifications announce revisions. Authoritative full documents still come from HTTPS.
const endpoint = "wss://ps-sync.origin.web.swisstiming.com/socket.io/?EIO=4&transport=websocket";

export function decodeNotification(packet) {
  if (typeof packet !== "string" || !/^\d{10}\{/.test(packet) || packet.length > 2_000_000) throw new Error("Invalid push envelope");
  const headerEnd = 10 + Number(packet.slice(0, 10));
  const header = JSON.parse(packet.slice(10, headerEnd));
  let body = packet.slice(headerEnd);
  if (header.compressor === "lzw") {
    if (!body) throw new Error("Empty LZW payload");
    const dictionary = Array.from({ length: 256 }, (_, i) => String.fromCharCode(i));
    let previous = body[0], decoded = previous;
    for (let index = 1; index < body.length; index++) {
      const code = body.charCodeAt(index);
      const entry = dictionary[code] ?? (code === dictionary.length ? previous + previous[0] : null);
      if (entry === null) throw new Error("Invalid LZW code");
      decoded += entry;
      if (decoded.length > 2_000_000) throw new Error("Push payload too large");
      dictionary.push(previous + entry[0]); previous = entry;
    }
    body = decodeURIComponent(decoded);
  } else if (header.compressor) throw new Error("Unknown push compression");
  const message = JSON.parse(body);
  if (header.type !== "data" || message.code !== "data" || typeof message.Channel !== "string" || !Number.isSafeInteger(message.sync)) return null;
  return { channel: message.Channel, uid: message.sync };
}

export class SwissPush {
  constructor({ onRevision, socketFactory = (url) => new WebSocket(url), clock = Date.now } = {}) {
    this.onRevision = onRevision; this.socketFactory = socketFactory; this.clock = clock;
    this.channels = new Set(); this.socket = null; this.connected = false; this.lastAt = null;
    this.reconnect = null; this.watchdog = null; this.closed = false; this.failures = 0;
    this.ack = 0;
  }
  setChannels(channels) {
    const next = new Set(channels);
    if (this.connected) {
      for (const name of this.channels) if (!next.has(name)) this.send("leave", name);
      for (const name of next) if (!this.channels.has(name)) this.send("join", name);
    }
    this.channels = next;
    if (!this.socket && !this.reconnect && next.size && !this.closed) this.connect();
  }
  send(event, channel) { this.socket?.send("42" + this.ack++ + JSON.stringify([event, channel])); }
  connect() {
    if (this.closed) return;
    const socket = this.socketFactory(endpoint); this.socket = socket;
    const touch = (ms = 45000) => {
      clearTimeout(this.watchdog);
      this.watchdog = setTimeout(() => socket.close(), ms); this.watchdog.unref?.();
    };
    touch(12000);
    socket.addEventListener("message", (event) => {
      if (this.socket !== socket || this.closed) return;
      const packet = String(event.data); touch();
      try {
        if (packet.startsWith("0")) { socket.send("40"); return; }
        if (packet === "2") { socket.send("3"); return; }
        if (packet.startsWith("40")) {
          this.connected = true; this.failures = 0;
          for (const channel of this.channels) this.send("join", channel);
          // Reconcile after reconnect; joining with no ack ID is sufficient for read-only notifications.
          this.onRevision?.({ channel: null, uid: null, reconnect: true }); return;
        }
        if (packet.startsWith("41")) { socket.close(); return; }
        if (!packet.startsWith("42[")) return;
        const [name, payload] = JSON.parse(packet.slice(2));
        if (name !== "message") return;
        const notification = decodeNotification(payload);
        if (!notification || !this.channels.has(notification.channel)) return;
        this.lastAt = this.clock(); this.onRevision?.(notification);
      } catch { socket.close(); } // Reject unknown formats; HTTP remains available.
    });
    socket.addEventListener("error", () => socket.close());
    socket.addEventListener("close", () => {
      if (this.socket !== socket) return;
      this.socket = null; this.connected = false; clearTimeout(this.watchdog);
      if (!this.closed && this.channels.size) {
        this.reconnect = setTimeout(() => { this.reconnect = null; this.connect(); }, Math.min(30000, 1000 * 2 ** Math.min(this.failures++, 5)));
        this.reconnect.unref?.();
      }
    });
  }
  close() {
    this.closed = true; clearTimeout(this.reconnect); clearTimeout(this.watchdog);
    this.socket?.close(); this.socket = null; this.connected = false;
  }
}
