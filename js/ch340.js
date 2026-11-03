// Driver mínimo do chip CH340/CH341 sobre WebUSB.
// Os Arduinos clone (Mega com CH340) não são CDC-ACM, então o polyfill do Google não os abre.
// Aqui falamos com o chip direto (comandos de controle do fabricante + endpoints bulk),
// e entregamos um objeto com a mesma forma de uma SerialPort: open(), close(), readable, writable.
// Referência dos comandos: driver ch341 do Linux e usb-serial-for-android.

export const CH340_VENDOR = 0x1a86;

const REQ_READ_VERSION = 0x5f;
const REQ_SERIAL_INIT = 0xa1;
const REQ_WRITE_REG = 0x9a;
const REQ_MODEM_CTRL = 0xa4;
const LCR_8N1 = 0x80 | 0x40 | 0x03;   // RX on, TX on, 8 bits, sem paridade, 1 stop
const PACKET = 64;

export class Ch340Port {
  constructor(device) {
    this.device_ = device;
    this.readable = null;
    this.writable = null;
    this.opened_ = false;
    this.iface_ = this.inEp_ = this.outEp_ = null;
  }

  getInfo() { return { usbVendorId: this.device_.vendorId, usbProductId: this.device_.productId }; }

  async _out(request, value, index = 0) {
    const r = await this.device_.controlTransferOut({ requestType: "vendor", recipient: "device", request, value, index });
    if (r.status !== "ok") throw new Error(`CH340: comando 0x${request.toString(16)} falhou (${r.status})`);
  }

  async _setBaud(baud) {
    let factor, divisor;
    if (baud === 921600) { divisor = 7; factor = 0xf300; }
    else {
      factor = Math.floor(1532620800 / baud);
      divisor = 3;
      while (factor > 0xfff0 && divisor > 0) { factor >>= 3; divisor--; }
      if (factor > 0xfff0) throw new Error("CH340: baud rate fora do alcance");
      factor = 0x10000 - factor;
    }
    divisor |= 0x80;   // sem isso o chip espera o buffer encher antes de entregar
    await this._out(REQ_WRITE_REG, 0x1312, (factor & 0xff00) | divisor);
    await this._out(REQ_WRITE_REG, 0x0f2c, factor & 0xff);
  }

  async _setLines(dtr, rts) {
    await this._out(REQ_MODEM_CTRL, ~((dtr ? 0x20 : 0) | (rts ? 0x40 : 0)) & 0xff, 0);
  }

  _findEndpoints() {
    for (const itf of this.device_.configuration.interfaces) {
      for (const alt of itf.alternates) {
        const inEp = alt.endpoints.find((e) => e.type === "bulk" && e.direction === "in");
        const outEp = alt.endpoints.find((e) => e.type === "bulk" && e.direction === "out");
        if (inEp && outEp) return { itf, alt, inEp, outEp };
      }
    }
    throw new Error("CH340: não achei os endpoints bulk");
  }

  async open({ baudRate = 115200 } = {}) {
    const d = this.device_;
    await d.open();
    try {
      if (d.configuration === null) await d.selectConfiguration(1);
      const { itf, alt, inEp, outEp } = this._findEndpoints();
      await d.claimInterface(itf.interfaceNumber);
      if (alt.alternateSetting) await d.selectAlternateInterface(itf.interfaceNumber, alt.alternateSetting);
      this.iface_ = itf.interfaceNumber;
      this.inEp_ = inEp.endpointNumber;
      this.outEp_ = outEp.endpointNumber;

      const v = await d.controlTransferIn({ requestType: "vendor", recipient: "device", request: REQ_READ_VERSION, value: 0, index: 0 }, 2);
      if (v.status !== "ok") throw new Error("CH340: o chip não respondeu (não parece um CH340)");
      await this._out(REQ_SERIAL_INIT, 0, 0);
      await this._setBaud(baudRate);
      await this._out(REQ_WRITE_REG, 0x2518, LCR_8N1);
      await this._setLines(true, true);
    } catch (e) {
      try { await d.close(); } catch {}
      throw e;
    }
    this.opened_ = true;

    this.readable = new ReadableStream({
      pull: async (controller) => {
        try {
          const r = await d.transferIn(this.inEp_, PACKET);
          if (r.status === "stall") await d.clearHalt("in", this.inEp_);
          else if (r.status === "ok" && r.data && r.data.byteLength) {
            controller.enqueue(new Uint8Array(r.data.buffer, r.data.byteOffset, r.data.byteLength).slice());
          }
        } catch (e) {
          try { if (this.opened_) controller.error(e); else controller.close(); } catch {}
        }
      },
    });

    this.writable = new WritableStream({
      write: async (chunk) => {
        for (let i = 0; i < chunk.length; i += PACKET) {
          const r = await d.transferOut(this.outEp_, chunk.slice(i, i + PACKET));
          if (r.status === "stall") { await d.clearHalt("out", this.outEp_); throw new Error("CH340: escrita travou"); }
          if (r.status !== "ok") throw new Error("CH340: erro ao enviar (" + r.status + ")");
        }
      },
    });
  }

  async close() {
    if (!this.opened_) return;
    this.opened_ = false;
    try { await this._setLines(false, false); } catch {}
    try { await this.device_.releaseInterface(this.iface_); } catch {}
    try { await this.device_.close(); } catch {}
    this.readable = null;
    this.writable = null;
  }
}
