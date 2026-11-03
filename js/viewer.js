// Visualizador: um mostrador por servo (portado do render_viewer do motion.py), desenhado em canvas.
import { C, FONT, FONT_MONO, clamp, mix, drawRR, circle, fitCanvas, rafOnce, fmtValue } from "./util.js";

const PX = 1.3;     // os tamanhos do Tk eram em pontos; aqui são pixels

export class Viewer {
  constructor(canvas, store) {
    this.cv = canvas; this.ctx = canvas.getContext("2d"); this.store = store;
    this.cards = [];            // {sid, x1,y1,x2,y2,cx,cy, R, wr}
    this.spin = {};             // sid -> rotação (graus)
    this.bg = null; this.bgKey = "";
    this.drag = null;
    this._last = performance.now();
    this.invalidate = rafOnce(() => this.draw());
    store.on("angle", () => this.invalidate());
    store.on("servos", () => this.invalidate());
    store.on("servos-meta", () => this.invalidate());
    new ResizeObserver(() => this.invalidate()).observe(canvas);
    canvas.addEventListener("pointerdown", (e) => this.down(e));
    canvas.addEventListener("pointermove", (e) => this.move(e));
    canvas.addEventListener("pointerup", (e) => { this.drag = null; });
    canvas.addEventListener("pointercancel", () => { this.drag = null; });
  }

  static gridFor(n, w, h) {
    let best = [1, n, 1e9];
    for (let c = 1; c <= n; c++) {
      const r = Math.ceil(n / c);
      const aspect = ((w - 28) / c) / Math.max(1, (h - 28) / r);
      const score = Math.abs(Math.log(Math.max(aspect, 0.01) / 1.3));
      if (score < best[2]) best = [c, r, score];
    }
    return [best[0], best[1]];
  }

  confetti(w, h, dpr) {
    const key = `${w}x${h}@${dpr}`;
    if (this.bgKey === key) return this.bg;
    const off = document.createElement("canvas");
    off.width = w * dpr; off.height = h * dpr;
    const g = off.getContext("2d"); g.scale(dpr, dpr);
    let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const cols = ["#33276a", "#3d3070", "#2f2466", "#463a85"], kinds = ["dot", "ring", "plus", "squig", "spark"];
    const n = Math.floor(w * h / 6500);
    g.lineCap = "round";
    for (let i = 0; i < n; i++) {
      const x = 10 + rnd() * (w - 20), y = 10 + rnd() * (h - 20), c = cols[Math.floor(rnd() * 4)], k = kinds[Math.floor(rnd() * 5)];
      g.fillStyle = c; g.strokeStyle = c; g.lineWidth = 2;
      if (k === "dot") { const r = 2 + rnd() * 1.5; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); }
      else if (k === "ring") { const r = 4 + rnd() * 4; g.beginPath(); g.arc(x, y, r, 0, 7); g.stroke(); }
      else if (k === "plus") { const r = 4 + rnd() * 3; g.beginPath(); g.moveTo(x - r, y); g.lineTo(x + r, y); g.moveTo(x, y - r); g.lineTo(x, y + r); g.stroke(); }
      else if (k === "squig") { g.beginPath(); g.moveTo(x - 12, y); g.quadraticCurveTo(x - 9, y - 6, x - 3, y - 2); g.quadraticCurveTo(x + 3, y + 5, x + 6, y + 3); g.lineTo(x + 12, y); g.stroke(); }
      else { const r = 5 + rnd() * 4; g.beginPath(); g.moveTo(x, y - r); g.lineTo(x + r * .25, y - r * .25); g.lineTo(x + r, y); g.lineTo(x + r * .25, y + r * .25); g.lineTo(x, y + r); g.lineTo(x - r * .25, y + r * .25); g.lineTo(x - r, y); g.lineTo(x - r * .25, y - r * .25); g.closePath(); g.fill(); }
    }
    this.bg = off; this.bgKey = key;
    return off;
  }

  draw() {
    const { w, h, dpr } = fitCanvas(this.cv);
    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#1d1540"; ctx.fillRect(0, 0, w, h);
    if (w > 20 && h > 20) ctx.drawImage(this.confetti(w, h, dpr), 0, 0, w, h);
    this.cards = [];
    const sids = this.store.sids();
    ctx.textBaseline = "middle";
    if (!sids.length) {
      ctx.textAlign = "center";
      ctx.fillStyle = C.DIM; ctx.font = `700 ${Math.round(17 * PX)}px ${FONT}`; ctx.fillText("Nenhum servo na cena", w / 2, h / 2 - 16);
      ctx.fillStyle = C.FAINT; ctx.font = `700 ${Math.round(10 * PX)}px ${FONT}`; ctx.fillText("Adicione um servo na aba Servos para começar.", w / 2, h / 2 + 16);
      return;
    }
    const now = performance.now(), dt = Math.min(0.2, (now - this._last) / 1000); this._last = now;
    const [cols, nrows] = Viewer.gridFor(sids.length, w, h);
    const pad = 14, gap = 12;
    const cw = (w - pad * 2 - gap * (cols - 1)) / cols, ch = (h - pad * 2 - gap * (nrows - 1)) / nrows;
    let spinning = false;
    sids.forEach((sid, i) => {
      const r_ = Math.floor(i / cols), c_ = i % cols;
      const x1 = pad + c_ * (cw + gap), y1 = pad + r_ * (ch + gap), x2 = x1 + cw, y2 = y1 + ch;
      const row = this.store.rows[sid], a = clamp(row.angle, 0, 180), color = row.color;
      drawRR(ctx, x1 + 4, y1 + 5, x2 + 4, y2 + 5, 16, C.INK, C.INK, 1);
      drawRR(ctx, x1, y1, x2, y2, 16, mix(color, "#241a4d", .74), C.INK, 3);
      circle(ctx, x1 + 18, y1 + 18, 4, color);
      const small = cw < 150;
      ctx.textAlign = "left"; ctx.fillStyle = C.TEXT; ctx.font = `700 ${Math.round((small ? 9 : 10) * PX)}px ${FONT}`;
      const tag = (row.kind === "continuous" ? "360 · " : "") + `D${row.pin}`;
      ctx.font = `700 ${Math.round(8 * PX)}px ${FONT_MONO}`;
      const tw = ctx.measureText(tag).width;
      ctx.font = `700 ${Math.round((small ? 9 : 10) * PX)}px ${FONT}`;
      let name = row.name; const maxW = cw - 30 - tw - 26;
      while (name.length > 1 && ctx.measureText(name).width > maxW) name = name.slice(0, -1);
      if (name !== row.name) name += "…";
      ctx.fillText(name, x1 + 30, y1 + 18);
      ctx.textAlign = "right"; ctx.fillStyle = C.FAINT; ctx.font = `700 ${Math.round(8 * PX)}px ${FONT_MONO}`;
      ctx.fillText(tag, x2 - 14, y1 + 18);

      const R = Math.max(18, Math.min((cw - 60) / 2, ch - 100));
      const thick = Math.max(8, Math.min(20, R * .22));
      const extra = ch - (44 + R + 54);
      const cx = (x1 + x2) / 2, cy = y1 + 44 + R + Math.max(0, extra / 2);
      const hr = Math.max(11, Math.min(16, R * .2)), er = hr * .34;
      const tsize = Math.round(Math.max(13, Math.min(30, R / 3.2)) * PX);
      if (row.kind === "continuous") {
        const wr = R * .6, wy = cy - R * .42, L = wr - thick * .5 - 3, speed = (a - 90) / 90;
        if (speed) { this.spin[sid] = ((this.spin[sid] || 0) + speed * 540 * dt) % 360; spinning = true; }
        const rot = this.spin[sid] || 0;
        ctx.beginPath(); ctx.arc(cx, wy, wr, 0, 7); ctx.strokeStyle = C.INK; ctx.lineWidth = thick + 6; ctx.stroke();
        ctx.strokeStyle = "#1d1540"; ctx.lineWidth = thick; ctx.stroke();
        ctx.fillStyle = C.FAINT; ctx.font = `700 ${Math.round(9 * PX)}px ${FONT}`; ctx.textAlign = "center";
        ctx.fillText("−", cx - R, cy + 14); ctx.fillText("+", cx + R, cy + 14);
        ctx.lineCap = "round";
        for (let k = 0; k < 3; k++) {
          const rad = (rot + k * 120) * Math.PI / 180, ex = cx + L * Math.cos(rad), ey = wy + L * Math.sin(rad);
          ctx.beginPath(); ctx.moveTo(cx, wy); ctx.lineTo(ex, ey); ctx.strokeStyle = C.INK; ctx.lineWidth = 9; ctx.stroke();
          ctx.strokeStyle = color; ctx.lineWidth = 5; ctx.stroke();
        }
        const rad = rot * Math.PI / 180, kr = thick * .75;
        circle(ctx, cx + wr * Math.cos(rad), wy + wr * Math.sin(rad), kr, "#fffaf0", C.INK, 3);
        circle(ctx, cx, wy, hr, color, C.INK, 3);
        this.eyes(ctx, cx, wy, hr, er, Math.sign(speed), 0);
        this.cards.push({ sid, x1, y1, x2, y2, cx, cy, R, wr, wheel: true });
        ctx.fillStyle = C.TEXT; ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
        ctx.font = `700 ${tsize}px ${FONT_MONO}`; ctx.fillText(fmtValue("continuous", a), cx, cy + hr + 7 + tsize * .85);
        ctx.textBaseline = "middle";
        return;
      }
      // arco de fundo (semicírculo de cima: do oeste, pelo norte, ao leste)
      ctx.lineCap = "butt";
      ctx.beginPath(); ctx.arc(cx, cy, R, Math.PI, Math.PI * 2); ctx.strokeStyle = C.INK; ctx.lineWidth = thick + 6; ctx.stroke();
      ctx.strokeStyle = "#1d1540"; ctx.lineWidth = thick; ctx.stroke();
      ctx.lineCap = "round"; ctx.strokeStyle = C.LINE_HI; ctx.lineWidth = 2;
      for (const ang of [0, 45, 90, 135, 180]) {
        const rad = (180 - ang) * Math.PI / 180, r1 = R + thick / 2 + 4, r2 = r1 + (ang % 90 === 0 ? 7 : 3);
        ctx.beginPath(); ctx.moveTo(cx + r1 * Math.cos(rad), cy - r1 * Math.sin(rad)); ctx.lineTo(cx + r2 * Math.cos(rad), cy - r2 * Math.sin(rad)); ctx.stroke();
      }
      ctx.fillStyle = C.FAINT; ctx.font = `700 ${Math.round(7 * PX)}px ${FONT}`; ctx.textAlign = "center";
      ctx.fillText("0", cx - R, cy + 14); ctx.fillText("180", cx + R, cy + 14);
      const rad = (180 - a) * Math.PI / 180, cs = Math.cos(rad), sn = Math.sin(rad);
      if (a > 0) { ctx.beginPath(); ctx.arc(cx, cy, R, -Math.PI, -Math.PI + a * Math.PI / 180); ctx.strokeStyle = color; ctx.lineWidth = thick; ctx.lineCap = "butt"; ctx.stroke(); }
      const tip = R - thick * 1.4;
      ctx.lineCap = "round";
      for (const [lw, lc] of [[8, C.INK], [4, "#fffaf0"]]) { ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + tip * cs, cy - tip * sn); ctx.strokeStyle = lc; ctx.lineWidth = lw; ctx.stroke(); }
      circle(ctx, cx + R * cs, cy - R * sn, thick * .78, "#fffaf0", C.INK, 3);
      circle(ctx, cx, cy, hr, color, C.INK, 3);
      this.eyes(ctx, cx, cy, hr, er, cs, -sn);
      ctx.fillStyle = C.TEXT; ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
      ctx.font = `700 ${tsize}px ${FONT_MONO}`; ctx.fillText(fmtValue("position", a), cx, cy + hr + 7 + tsize * .85);
      ctx.textBaseline = "middle";
      this.cards.push({ sid, x1, y1, x2, y2, cx, cy, R });
    });
    if (spinning) this.invalidate();
  }

  eyes(ctx, cx, cy, hr, er, lookX, lookY) {
    for (const ex of [-hr * .4, hr * .4]) {
      const ecx = cx + ex, ecy = cy - hr * .1;
      circle(ctx, ecx, ecy, er, "#fffaf0", C.INK, 1.5);
      circle(ctx, ecx + er * .5 * lookX, ecy + er * .5 * lookY, er * .5, C.INK);
    }
  }

  pos(e) { const r = this.cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }
  down(e) {
    const [x, y] = this.pos(e);
    this.drag = null;
    for (const c of this.cards) {
      if (x >= c.x1 && x <= c.x2 && y >= c.y1 && y <= c.y2) {
        this.drag = c; this.cv.setPointerCapture(e.pointerId); this.move(e); return;
      }
    }
  }
  move(e) {
    const c = this.drag; if (!c || !(c.sid in this.store.rows)) return;
    if (e.buttons === 0 && e.pointerType === "mouse") return;
    const [x, y] = this.pos(e);
    if (c.wheel) {
      const f = clamp((x - c.cx) / Math.max(1, c.wr * 1.6), -1, 1);
      this.store.setAngle(c.sid, Math.abs(f) < .06 ? 90 : Math.round(90 + 90 * f));
      return;
    }
    let ang = Math.atan2(c.cy - y, x - c.cx) * 180 / Math.PI;
    if (ang < 0) ang = x >= c.cx ? 0 : 180;
    this.store.setAngle(c.sid, clamp(Math.round(180 - ang), 0, 180));
  }
}
