// Linha do tempo em canvas: régua, faixas por servo com curvas de valor, clipes de interpolação,
// keyframes arrastáveis, playhead. Toque: arrastar = rolar, pinça = zoom, toque na régua = mover playhead.
import { C, FONT, FONT_MONO, EASE_COLORS, EASE_SHORT, clamp, mix, lighten, ease, drawRR, circle, diamond,
  fitCanvas, rafOnce, fmtTime, fmtValue } from "./util.js";
import { Store } from "./store.js";

const X0 = 22;

export class Timeline {
  constructor(canvas, store) {
    this.cv = canvas; this.ctx = canvas.getContext("2d"); this.store = store;
    this.pps = 80; this.fit = true; this.sx = 0; this.sy = 0;
    const coarse = matchMedia("(pointer:coarse)").matches;
    this.RULER_H = coarse ? 38 : 32; this.SUM_H = coarse ? 44 : 38; this.LANE_H = coarse ? 60 : 52;
    this.headW = 188;
    this.layer = document.createElement("canvas");
    this.layerDirty = true; this.lastKey = "";
    this.hits = []; this.lanes = {};
    this.W = this.H = 1; this.vw = this.vh = 1;
    this.ptrs = new Map(); this.drag = null; this.pinch = null; this.lastTap = null;
    this.paintLayer = rafOnce(() => this.paint());
    this.repaint = () => { this.layerDirty = true; this.paintLayer(); };
    this.repaintOverlay = () => this.paintLayer();
    for (const ev of ["frames", "frames-lite", "selection", "servos", "servos-meta", "duration"]) store.on(ev, this.repaint);
    store.on("playhead", () => { this.follow(); this.repaintOverlay(); });
    store.on("angle", () => this.repaintOverlay());
    new ResizeObserver(() => this.repaint()).observe(canvas);
    canvas.style.touchAction = "none";
    canvas.addEventListener("pointerdown", (e) => this.down(e));
    canvas.addEventListener("pointermove", (e) => this.move(e));
    canvas.addEventListener("pointerup", (e) => this.up(e));
    canvas.addEventListener("pointercancel", (e) => this.up(e, true));
    canvas.addEventListener("wheel", (e) => this.wheel(e), { passive: false });
    canvas.addEventListener("dblclick", (e) => { if (e.pointerType === "touch") return; const p = this.pos(e); if (!this.hit(p[0], p[1]) && p[0] > this.headW && p[1] > this.RULER_H) this.store.addFrame(); });
  }

  // ───────────── métricas ─────────────
  niceStep() { for (const s of [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600]) if (s * this.pps >= 84) return s; return 600; }
  metrics(cssW, cssH) {
    const st = this.store;
    st.normalizeDuration();
    this.headW = cssW < 520 ? 104 : cssW < 900 ? 144 : 188;
    this.vw = Math.max(1, cssW - this.headW); this.vh = Math.max(1, cssH - this.RULER_H);
    const last = st.lastTime();
    const total = st.durationOverride === null ? Math.max(8, last + 2) : Math.max(1, st.durationOverride + 1);
    if (this.fit && this.vw > 150) this.pps = clamp((this.vw - X0 - 28) / total, 8, 280);
    this.W = Math.max(this.vw, Math.floor(X0 + total * this.pps + 60));
    this.H = Math.max(this.vh, this.SUM_H + 20 + st.sids().length * this.LANE_H + 12);
    this.sx = clamp(this.sx, 0, Math.max(0, this.W - this.vw));
    this.sy = clamp(this.sy, 0, Math.max(0, this.H - this.vh));
  }
  tAt(bx) { return Math.max(0, (bx - X0) / this.pps); }
  snap(t) { const tol = 6 / this.pps; for (const ft of this.store.sortedTimes()) if (Math.abs(ft - t) <= tol) return ft; return t; }
  pos(e) { const r = this.cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }

  // ───────────── desenho ─────────────
  paint() {
    const { w, h, dpr, changed } = fitCanvas(this.cv);
    const key = [w, h, dpr, this.pps, this.sx, this.sy].join();
    this.metrics(w, h);
    const ctx = this.ctx;
    if (this.layerDirty || changed || key !== this.lastKey || this.layer.width !== this.cv.width) {
      this.lastKey = key; this.layerDirty = false;
      if (this.layer.width !== this.cv.width || this.layer.height !== this.cv.height) { this.layer.width = this.cv.width; this.layer.height = this.cv.height; }
      this.buildLayer(w, h, dpr);
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.layer, 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.drawOverlay(ctx, w, h);
  }

  buildLayer(w, h, dpr) {
    const g = this.layer.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = C.BG; g.fillRect(0, 0, w, h);
    const { headW, RULER_H } = this;
    g.save(); g.beginPath(); g.rect(headW, RULER_H, this.vw, this.vh); g.clip();
    g.translate(headW - this.sx, RULER_H - this.sy); this.drawBody(g); g.restore();
    g.save(); g.beginPath(); g.rect(headW, 0, this.vw, RULER_H); g.clip();
    g.translate(headW - this.sx, 0); this.drawRuler(g); g.restore();
    g.save(); g.beginPath(); g.rect(0, RULER_H, headW, this.vh); g.clip();
    g.translate(0, RULER_H - this.sy); this.drawHead(g); g.restore();
    g.fillStyle = "#2a1f58"; g.fillRect(0, 0, headW, RULER_H);
    g.fillStyle = C.FAINT; g.font = `700 ${Math.round(8 * 1.3)}px ${FONT}`; g.textAlign = "left"; g.textBaseline = "middle";
    g.fillText("Faixas", 16, RULER_H / 2);
  }

  visibleT() { return [Math.max(0, (this.sx - X0) / this.pps), (this.sx + this.vw - X0) / this.pps]; }

  drawRuler(g) {
    const { pps, RULER_H: RH, W } = this, step = this.niceStep(), minor = step / 5;
    const [t0, t1] = this.visibleT();
    g.fillStyle = "#2a1f58"; g.fillRect(this.sx, 0, this.vw, RH);
    const k0 = Math.max(0, Math.floor(t0 / minor) - 5), k1 = Math.ceil(t1 / minor) + 5;
    g.textBaseline = "middle"; g.textAlign = "left";
    for (let k = k0; k <= k1; k++) {
      const t = k * minor, x = X0 + t * pps;
      if (k % 5 === 0) {
        g.fillStyle = Math.floor(k / 5) % 2 ? "#3b2f75" : "#33276a"; g.fillRect(x, 0, step * pps, RH - 1);
      }
    }
    g.lineCap = "round";
    for (let k = k0; k <= k1; k++) {
      const t = k * minor, x = X0 + t * pps;
      if (k % 5 === 0) {
        g.strokeStyle = C.INK; g.lineWidth = 3; g.beginPath(); g.moveTo(x, RH - 16); g.lineTo(x, RH); g.stroke();
        g.fillStyle = C.DIM; g.font = `700 ${Math.round(8 * 1.3)}px ${FONT_MONO}`;
        g.fillText(this.rulerLabel(t, step), x + 6, 12);
      } else if (minor * pps >= 7) {
        g.strokeStyle = C.FAINT; g.lineWidth = 2; g.beginPath(); g.moveTo(x, RH - 7); g.lineTo(x, RH); g.stroke();
      }
    }
    g.strokeStyle = C.INK; g.lineWidth = 3; g.beginPath(); g.moveTo(this.sx, RH - 1); g.lineTo(this.sx + this.vw, RH - 1); g.stroke();
    const dur = this.store.duration();
    if (dur > 0) {
      const xe = X0 + dur * pps;
      g.fillStyle = "#1d1540"; g.fillRect(xe, 0, W - xe, RH - 1);
      g.strokeStyle = C.SELECT; g.lineWidth = 3; g.beginPath(); g.moveTo(xe, RH - 16); g.lineTo(xe, RH); g.stroke();
    }
  }
  rulerLabel(t, step) {
    const m = Math.floor(t / 60), s = t - m * 60;
    return step < 1 ? `${String(m).padStart(2, "0")}:${s.toFixed(2).padStart(5, "0")}` : `${String(m).padStart(2, "0")}:${String(Math.round(s)).padStart(2, "0")}`;
  }

  drawHead(g) {
    const { headW, SUM_H, LANE_H, store } = this;
    drawRR(g, 6, 3, headW - 6, SUM_H + 3, 12, "#2e2262", C.INK, 2.5);
    diamond(g, 24, SUM_H / 2 + 3, 5.5, C.SELECT, C.SELECT, 1);
    g.textBaseline = "middle"; g.textAlign = "left";
    if (headW >= 120) { g.fillStyle = C.TEXT; g.font = `700 ${Math.round(9 * 1.3)}px ${FONT}`; g.fillText("Keyframes", 40, SUM_H / 2 + 3); }
    store.sids().forEach((sid, i) => {
      const r = store.rows[sid], y0 = SUM_H + 8 + i * LANE_H, cy = y0 + LANE_H / 2;
      drawRR(g, 6, y0 + 3, headW - 6, y0 + LANE_H - 3, 12, mix(r.color, "#241a4d", .8), C.INK, 2.5);
      circle(g, 20, cy, 6, r.color, C.INK, 2);
      g.font = `700 ${Math.round(9 * 1.3)}px ${FONT}`; g.fillStyle = C.TEXT;
      const maxW = headW - 36 - (headW >= 150 ? 64 : 10);
      let name = r.name; while (name.length > 1 && g.measureText(name).width > maxW) name = name.slice(0, -1);
      if (name !== r.name) name += "…";
      const compact = headW < 150;
      g.fillText(name, 32, compact ? y0 + 20 : y0 + 19);
      if (!compact) {
        g.fillStyle = C.FAINT; g.font = `${Math.round(8 * 1.3)}px ${FONT_MONO}`;
        g.fillText(`Pino D${r.pin}` + (r.kind === "continuous" ? " · 360" : ""), 32, y0 + 34);
      }
    });
  }

  drawBody(g) {
    const { SUM_H, LANE_H, pps, W, H, store } = this;
    const fs = store.sortedFrames(), sids = store.sids();
    this.hits = []; this.lanes = {};
    drawRR(g, 4, 3, W - 4, SUM_H + 3, 12, "#2a1f58", C.INK, 2.5);
    sids.forEach((sid, i) => {
      const y0 = SUM_H + 8 + i * LANE_H;
      drawRR(g, 4, y0 + 3, W - 4, y0 + LANE_H - 3, 12, mix(store.rows[sid].color, "#241a4d", .88), C.INK, 2.5);
      this.lanes[sid] = [y0 + 9, y0 + LANE_H - 9];
    });
    // guias pontilhadas
    const step = this.niceStep(), minor = step / 5, [t0, t1] = this.visibleT();
    g.strokeStyle = "#5a4c9c"; g.lineWidth = 1; g.setLineDash([2, 6]);
    for (let k = Math.max(0, Math.floor(t0 / minor) - 5); k <= Math.ceil(t1 / minor) + 5; k++) {
      if (k % 5) continue; const x = X0 + k * minor * pps;
      g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke();
    }
    g.setLineDash([]);
    // fim da animação
    const dur = store.duration();
    if (dur > 0) {
      const xe = X0 + dur * pps;
      g.fillStyle = "rgba(20,13,46,.5)"; g.fillRect(xe, 0, W - xe, H);
      g.strokeStyle = C.SELECT; g.lineWidth = 3; g.setLineDash([6, 5]); g.beginPath(); g.moveTo(xe, 0); g.lineTo(xe, H); g.stroke(); g.setLineDash([]);
    }
    // curvas de valor
    g.lineJoin = "round"; g.lineCap = "round";
    for (const sid of sids) {
      const [top, bot] = this.lanes[sid], span = bot - top, color = store.rows[sid].color;
      const yOf = (a) => bot - (a / 180) * span;
      g.strokeStyle = "#4a3d85"; g.lineWidth = 1; g.setLineDash([2, 6]);
      g.beginPath(); g.moveTo(8, yOf(90)); g.lineTo(W - 8, yOf(90)); g.stroke(); g.setLineDash([]);
      const series = Store.series(sid, fs);
      if (!series.length) continue;
      const card = mix(color, "#241a4d", .88), fillC = mix(color, card, .8);
      const segs = [[[X0, yOf(series[0].a)], [X0 + series[0].t * pps, yOf(series[0].a)]]];
      for (let i = 0; i < series.length - 1; i++) {
        const s0 = series[i], s1 = series[i + 1], x0 = X0 + s0.t * pps, x1 = X0 + s1.t * pps;
        const seg = [[x0, yOf(s0.a)]];
        if (s0.e === "hold") seg.push([x1, yOf(s0.a)]);
        else {
          const n = Math.max(2, Math.min(90, Math.floor((x1 - x0) / 3)));
          for (let j = 1; j < n; j++) { const p = j / n; seg.push([x0 + (x1 - x0) * p, yOf(s0.a + (s1.a - s0.a) * ease(p, s0.e))]); }
        }
        seg.push([x1, yOf(s1.a)]); segs.push(seg);
      }
      const ls = series[series.length - 1];
      segs.push([[X0 + ls.t * pps, yOf(ls.a)], [W - 6, yOf(ls.a)]]);
      for (const seg of segs) {
        if (seg.length === 2 && seg[0][0] === seg[1][0] && seg[0][1] === seg[1][1]) continue;
        g.beginPath(); g.moveTo(seg[0][0], seg[0][1]);
        for (const p of seg) g.lineTo(p[0], p[1]);
        g.lineTo(seg[seg.length - 1][0], bot + 4); g.lineTo(seg[0][0], bot + 4); g.closePath();
        g.fillStyle = fillC; g.fill();
        g.beginPath(); g.moveTo(seg[0][0], seg[0][1]);
        for (const p of seg) g.lineTo(p[0], p[1]);
        g.strokeStyle = color; g.lineWidth = 3; g.stroke();
      }
      for (const s of series) {
        const idx = store.frames.indexOf(s.f), sel = idx === store.selected, r = sel ? 7 : 5.5;
        const x = X0 + s.t * pps, y = yOf(s.a);
        diamond(g, x, y, r, sel ? C.SELECT : lighten(color, .25), sel ? "#fffaf0" : C.INK, 2.5);
        this.hits.push({ type: "kf", idx, sid, x, y });
      }
    }
    // clipes de interpolação + keyframes (faixa resumo)
    for (let i = 0; i < fs.length - 1; i++) {
      const f0 = fs[i], f1 = fs[i + 1], x0 = X0 + f0.time * pps, x1 = X0 + f1.time * pps;
      const ec = EASE_COLORS[f0.ease || "linear"] || C.DIM, idx0 = store.frames.indexOf(f0), sel = idx0 === store.selected;
      drawRR(g, x0 + 3, 6, x1 - 3, SUM_H - 1, 9, mix(ec, "#2a1f58", .7), sel ? C.SELECT : C.INK, sel ? 3 : 2);
      if (x1 - x0 > 76) { g.fillStyle = ec; g.font = `700 ${Math.round(8 * 1.3)}px ${FONT}`; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(EASE_SHORT[f0.ease] || "", (x0 + x1) / 2, SUM_H / 2 + 2); }
      this.hits.push({ type: "clip", idx: idx0, x0, x1 });
    }
    for (const f of fs) {
      const idx = store.frames.indexOf(f), sel = idx === store.selected, x = X0 + f.time * pps, y = SUM_H / 2 + 2;
      diamond(g, x, y, sel ? 8 : 7, sel ? C.SELECT : "#fffaf0", sel ? "#fffaf0" : C.INK, 2.5);
      this.hits.push({ type: "kf", idx, sid: null, x, y });
    }
    g.fillStyle = C.FAINT; g.font = `${Math.round(10 * 1.3)}px ${FONT}`; g.textAlign = "left"; g.textBaseline = "middle";
    if (!sids.length) g.fillText("Adicione um servo para começar.", X0 + 8, SUM_H + 46);
    else if (!store.frames.length) g.fillText("Toque duas vezes (ou use ◆ Keyframe) para criar o primeiro keyframe", X0 + 10, SUM_H / 2 + 2);
  }

  drawOverlay(g, w, h) {
    const { headW, RULER_H, SUM_H, LANE_H, store } = this;
    // valores atuais nos cabeçalhos das faixas
    g.save(); g.beginPath(); g.rect(0, RULER_H, headW, this.vh); g.clip(); g.translate(0, RULER_H - this.sy);
    const compact = headW < 150;
    store.sids().forEach((sid, i) => {
      const r = store.rows[sid], y0 = SUM_H + 8 + i * LANE_H;
      g.fillStyle = r.color; g.font = `700 ${Math.round(11 * 1.3)}px ${FONT_MONO}`; g.textBaseline = "middle";
      if (compact) { g.textAlign = "left"; g.fillText(fmtValue(r.kind, r.angle), 32, y0 + 38); }
      else { g.textAlign = "right"; g.fillText(fmtValue(r.kind, r.angle), headW - 16, y0 + LANE_H / 2); }
    });
    g.restore();
    // playhead
    const x = headW + X0 + store.playhead * this.pps - this.sx;
    if (x >= headW - 40 && x <= w + 40) {
      g.save(); g.beginPath(); g.rect(headW, 0, this.vw, h); g.clip();
      g.strokeStyle = C.PLAYHEAD; g.lineWidth = 3; g.beginPath(); g.moveTo(x, RULER_H); g.lineTo(x, h); g.stroke();
      const lx = clamp(x, headW + 38, w - 38);         // o rótulo não sai da régua
      drawRR(g, lx - 37, 3, lx + 37, 23, 9, C.PLAYHEAD, C.INK, 2);
      g.beginPath(); g.moveTo(x - 5, 22); g.lineTo(x + 5, 22); g.lineTo(x, 29); g.closePath(); g.fillStyle = C.PLAYHEAD; g.fill();
      g.fillStyle = C.INK; g.font = `700 ${Math.round(8 * 1.3)}px ${FONT_MONO}`; g.textAlign = "center"; g.textBaseline = "middle";
      g.fillText(fmtTime(store.playhead), lx, 13.5);
      g.restore();
    }
    // barras de rolagem discretas
    g.fillStyle = "rgba(143,130,207,.55)";
    if (this.W > this.vw + 1) { const bw = this.vw * this.vw / this.W; g.fillRect(headW + (this.vw - bw) * (this.sx / (this.W - this.vw)), h - 4, bw, 3); }
    if (this.H > this.vh + 1) { const bh = this.vh * this.vh / this.H; g.fillRect(w - 4, RULER_H + (this.vh - bh) * (this.sy / (this.H - this.vh)), 3, bh); }
  }

  /** Mantém o playhead à vista durante a reprodução. */
  follow() {
    if (!this.store.animating || this.fit) return;
    const x = X0 + this.store.playhead * this.pps;
    if (x > this.sx + this.vw - 30 || x < this.sx) { this.sx = clamp(x - 80, 0, Math.max(0, this.W - this.vw)); this.layerDirty = true; }
  }

  // ───────────── zoom / rolagem ─────────────
  zoomAt(factor, anchorPx = null) {
    const old = this.pps, nw = clamp(old * factor, 8, 280);
    if (Math.abs(nw - old) < 1e-6) return;
    if (anchorPx === null) anchorPx = this.vw / 2;
    const tA = (this.sx + anchorPx - X0) / old;
    this.setPps(nw);
    this.sx = Math.max(0, X0 + tA * nw - anchorPx);
    this.repaint();
  }
  setPps(v) { this.fit = false; this.pps = clamp(v, 8, 280); this.emitZoom(); this.repaint(); }
  fitAll() { this.fit = true; this.sx = 0; this.emitZoom(); this.repaint(); }
  emitZoom() { this.onZoom && this.onZoom(this.pps); }

  wheel(e) {
    e.preventDefault();
    const [x] = this.pos(e);
    if (e.ctrlKey) { this.zoomAt(e.deltaY < 0 ? 1.18 : 1 / 1.18, x - this.headW); return; }
    if (e.shiftKey) this.sx += e.deltaY + e.deltaX; else { this.sy += e.deltaY; this.sx += e.deltaX; }
    this.sx = Math.max(0, this.sx); this.sy = Math.max(0, this.sy);
    this.repaint();
  }

  // ───────────── interação ─────────────
  hit(x, y) {
    if (x < this.headW || y < this.RULER_H) return null;
    const bx = x - this.headW + this.sx, by = y - this.RULER_H + this.sy;
    const R = matchMedia("(pointer:coarse)").matches ? 19 : 11;
    let best = null, bd = R * R;
    for (const h of this.hits) {
      if (h.type !== "kf") continue;
      const d = (h.x - bx) ** 2 + (h.y - by) ** 2;
      if (d <= bd) { bd = d; best = h; }
    }
    if (best) return best;
    if (by >= 6 && by <= this.SUM_H) for (const h of this.hits) if (h.type === "clip" && bx >= h.x0 && bx <= h.x1) return h;
    return null;
  }

  down(e) {
    const [x, y] = this.pos(e);
    this.ptrs.set(e.pointerId, { x, y });
    this.cv.setPointerCapture(e.pointerId);
    document.activeElement && document.activeElement !== document.body && document.activeElement.blur?.();
    if (this.ptrs.size === 2) {                       // pinça
      const [a, b] = [...this.ptrs.values()];
      const mid = (a.x + b.x) / 2 - this.headW;
      this.pinch = { d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, pps0: this.pps, tA: (this.sx + mid - X0) / this.pps };
      this.drag = null; return;
    }
    const touch = e.pointerType === "touch" || e.pointerType === "pen";
    const st = this.store;
    if (y < this.RULER_H && x >= this.headW) { this.drag = { kind: "scrub" }; st.seek(this.snap(this.tAt(x - this.headW + this.sx))); return; }
    if (x < this.headW) { this.drag = { kind: "vpan", y0: y, sy0: this.sy }; return; }
    const hit = this.hit(x, y);
    if (hit && hit.type === "kf") {
      st.select(hit.idx);
      this.drag = { kind: "kf", frame: st.frames[hit.idx], sid: hit.sid, x0: x, y0: y, axis: null, touch };
    } else if (hit && hit.type === "clip") {
      st.select(hit.idx); this.drag = null;
    } else if (touch) {
      this.drag = { kind: "pan", x0: x, y0: y, sx0: this.sx, sy0: this.sy, moved: false, t0: performance.now() };
    } else {
      this.drag = { kind: "ph" };
      if (st.selected !== null) st.select(null);
      st.seek(this.snap(this.tAt(x - this.headW + this.sx)));
    }
  }

  move(e) {
    const [x, y] = this.pos(e);
    if (this.ptrs.has(e.pointerId)) this.ptrs.set(e.pointerId, { x, y });
    if (this.pinch && this.ptrs.size >= 2) {
      const [a, b] = [...this.ptrs.values()], d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const mid = (a.x + b.x) / 2 - this.headW;
      this.fit = false; this.pps = clamp(this.pinch.pps0 * d / this.pinch.d0, 8, 280);
      this.sx = Math.max(0, X0 + this.pinch.tA * this.pps - mid);
      this.emitZoom(); this.repaint(); return;
    }
    const d = this.drag; if (!d) return;
    const st = this.store, bx = x - this.headW + this.sx;
    if (d.kind === "scrub" || d.kind === "ph") { st.seek(this.snap(this.tAt(bx))); return; }
    if (d.kind === "pan") {
      const dx = x - d.x0, dy = y - d.y0;
      if (!d.moved && Math.hypot(dx, dy) < 7) return;
      d.moved = true;
      this.sx = clamp(d.sx0 - dx, 0, Math.max(0, this.W - this.vw)); this.sy = clamp(d.sy0 - dy, 0, Math.max(0, this.H - this.vh));
      this.repaint(); return;
    }
    if (d.kind === "vpan") { this.sy = clamp(d.sy0 - (y - d.y0), 0, Math.max(0, this.H - this.vh)); this.repaint(); return; }
    if (d.kind === "kf") {
      if (d.axis === null) {
        const dx = x - d.x0, dy = y - d.y0;
        if (Math.max(Math.abs(dx), Math.abs(dy)) < (d.touch ? 8 : 4)) return;
        d.axis = d.sid === null || Math.abs(dx) >= Math.abs(dy) ? "x" : "y";
        st.pushUndo();
      }
      if (d.axis === "x") {
        if (st.dragFrameTime(d.frame, (bx - X0) / this.pps)) this.emitFrameTime && this.emitFrameTime(d.frame.time);
      } else {
        const lane = this.lanes[d.sid]; if (!lane) return;
        const by = y - this.RULER_H + this.sy;
        st.dragFrameAngle(d.frame, d.sid, Math.round(clamp((lane[1] - by) / (lane[1] - lane[0]) * 180, 0, 180)));
      }
    }
  }

  up(e, cancelled = false) {
    this.ptrs.delete(e.pointerId);
    if (this.pinch) { if (this.ptrs.size < 2) this.pinch = null; this.drag = null; return; }
    const d = this.drag; this.drag = null;
    if (!d) return;
    const st = this.store;
    if (d.kind === "kf" && d.axis) { st.finishDrag(d.frame); st.say(d.axis === "x" ? "Keyframe movido" : "Valor do keyframe ajustado"); }
    else if (d.kind === "pan" && !d.moved && !cancelled) {
      const [x, y] = this.pos(e), now = performance.now();
      if (st.selected !== null) st.select(null);
      st.seek(this.snap(this.tAt(x - this.headW + this.sx)));
      if (this.lastTap && now - this.lastTap.t < 350 && Math.hypot(x - this.lastTap.x, y - this.lastTap.y) < 24) { st.addFrame(); this.lastTap = null; }
      else this.lastTap = { t: now, x, y };
    }
  }
}
