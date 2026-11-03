// Conexão com o Arduino Mega via Web Serial (nativo) ou WebUSB (polyfill).
// Protocolo (igual ao motion.py): ATTACH,id,pino · MOVE,id,valor · DETACH,id  (linhas terminadas em \n)
import { BAUD, Emitter } from "./util.js";

const BOOT_WAIT_MS = 1800;         // o Arduino reinicia ao abrir a porta
const FLUSH_MS = 33;               // ~30 Hz para o Arduino
const POLYFILL_URL = new URL("../vendor/web-serial-polyfill.js", import.meta.url).href;
// Mega original (0x2341) e Arduino SRL (0x2a03). Clones CH340 (0x1a86) não são CDC-ACM: o polyfill não os abre.
const USB_FILTERS = [{ usbVendorId: 0x2341 }, { usbVendorId: 0x2a03 }];

export class Link extends Emitter {
  constructor() {
    super();
    this.state = "offline";               // offline | connecting | online
    this.portName = "";
    this.pins = new Map();                // sid -> pino (para reanexar ao conectar)
    this.desired = new Map();             // sid -> valor desejado
    this.lastSent = new Map();
    this.port = this.writer = this.reader = null;
    this.ready = false;
    this._closing = false;
    this._timer = 0;
    this._enc = new TextEncoder();
    this._dec = new TextDecoder();
    this.forcePolyfill = false;
  }

  static get hasNative() { return "serial" in navigator; }
  static get hasUsb() { return "usb" in navigator; }

  log(kind, text) { this.emit("log", kind, text); }
  _setState(s) { this.state = s; this.emit("state", s); }

  // ----- API usada pelo app -----
  attach(sid, pin) { this.pins.set(sid, pin); if (this.ready) this._write(`ATTACH,${sid},${pin}`); }
  detach(sid) {
    this.pins.delete(sid); this.desired.delete(sid); this.lastSent.delete(sid);
    if (this.ready) this._write(`DETACH,${sid}`);
  }
  want(sid, value) { this.desired.set(sid, value); }
  send(msg) { return this._write(msg); }

  // ----- conexão -----
  async connect() {
    if (this.state !== "offline") return;
    let api, opts = {}, name;
    try {
      if (Link.hasNative && !this.forcePolyfill) { api = navigator.serial; name = "Web Serial nativo"; }
      else {
        const mod = await import(POLYFILL_URL);
        api = mod.serial; opts = { filters: USB_FILTERS }; name = "polyfill WebUSB";
      }
    } catch (e) { this.log("err", "Não consegui carregar o polyfill: " + e.message); this.emit("error", "Sem suporte a serial neste navegador"); return; }
    try {
      this.port = await api.requestPort(opts);          // exige um toque/clique do usuário
      this._setState("connecting");
      await this.port.open({ baudRate: BAUD });
    } catch (e) {
      this.port = null;
      this._setState("offline");
      if (e && e.name === "NotFoundError") this.log("sys", "Nenhuma porta escolhida.");
      else { this.log("err", `Falha ao abrir (${name}): ${e && e.message}`); this.emit("error", "Não foi possível abrir a porta: " + (e && e.message)); }
      return;
    }
    this.portName = name;
    this.log("sys", `Porta aberta via ${name}. Aguardando o Arduino reiniciar…`);
    this._closing = false; this.ready = false;
    this.writer = this.port.writable.getWriter();
    this._readLoop(this.port);
    const port = this.port;
    await new Promise((r) => setTimeout(r, BOOT_WAIT_MS));
    if (this.port !== port || this._closing) return;
    this.ready = true;
    this.lastSent.clear();
    for (const [sid, pin] of this.pins) this._write(`ATTACH,${sid},${pin}`);
    this._timer = setInterval(() => this.flush(), FLUSH_MS);
    this.flush();
    this._setState("online");
    this.log("sys", "Pronto.");
  }

  flush() {
    if (!this.ready) return;
    const lines = [];
    for (const [sid, v] of this.desired) {
      if (this.lastSent.get(sid) !== v && this.pins.has(sid)) { lines.push(`MOVE,${sid},${v}`); this.lastSent.set(sid, v); }
    }
    if (lines.length) this._write(lines.join("\n"));
  }

  async _readLoop(port) {
    let buf = "";
    try {
      this.reader = port.readable.getReader();
      for (;;) {
        const { value, done } = await this.reader.read();
        if (done) break;
        buf += this._dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
          if (!line) continue;
          this.log(line.startsWith("ERR") ? "err" : "rx", line);
          if (line.startsWith("ERR")) this.emit("error", "Arduino: " + line);
        }
      }
    } catch (e) {
      if (!this._closing) { this.log("err", "Conexão perdida: " + e.message); this.emit("error", "Conexão perdida: " + e.message); await this.disconnect(true); }
    } finally {
      try { this.reader && this.reader.releaseLock(); } catch {}
      this.reader = null;
    }
  }

  async _write(text) {
    if (!this.writer) return false;
    try {
      await this.writer.write(this._enc.encode(text + "\n"));
      for (const l of text.split("\n")) this.log("tx", l);
      return true;
    } catch (e) {
      this.log("err", "Erro ao enviar: " + e.message);
      this.disconnect(true);
      return false;
    }
  }

  async disconnect(lost = false) {
    if (!this.port || this._closing) return;
    this._closing = true;
    clearInterval(this._timer); this._timer = 0;
    const port = this.port;
    if (!lost && this.ready) {
      try { for (const sid of this.pins.keys()) await this._write(`DETACH,${sid}`); } catch {}
    }
    this.ready = false;
    this.lastSent.clear();
    try { await this.reader?.cancel(); } catch {}
    try { this.writer?.releaseLock(); } catch {}
    this.writer = null;
    try { await port.close(); } catch {}
    this.port = null;
    this._setState("offline");
    this.log("sys", lost ? "Desconectado (cabo ou porta perdida)." : "Desconectado.");
  }
}
