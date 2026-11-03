// Estado do projeto + lógica de keyframes, interpolação e reprodução (portado do motion.py).
import { Emitter, TRACK_COLORS, EASE_LABELS, MAX_SERVOS, clamp, ease } from "./util.js";

export class Store extends Emitter {
  constructor(link) {
    super();
    this.link = link;
    this.rows = {};                 // sid -> {id, name, pin, kind, angle, color}
    this.frames = [];               // {time, angles:{sid:int}, ease}
    this.selected = null;           // índice em frames
    this.durationOverride = null;
    this.playhead = 0;
    this.animating = false;
    this.loopOn = false;
    this.project = "Sem título";
    this.undoStack = []; this.redoStack = [];
    this._start = 0; this._offset = 0; this._raf = 0;
    this._tick = this._tick.bind(this);
  }

  say(msg) { this.emit("status", msg); }
  changed() { this.emit("dirty"); }

  // ───────────── servos ─────────────
  sids() { return Object.keys(this.rows).map(Number).sort((a, b) => a - b); }
  nextFreeId() { for (let i = 0; i < MAX_SERVOS; i++) if (!(i in this.rows)) return i; return null; }
  pinInUse(pin, exceptSid = null) { return Object.values(this.rows).some((r) => r.pin === pin && r.id !== exceptSid); }
  defaultPin() { for (let p = 2; p < 54; p++) if (!this.pinInUse(p)) return p; return 2; }

  createServo(id, name, pin, angle = 90, kind = "position") {
    const row = { id, name, pin, kind, angle, color: TRACK_COLORS[id % TRACK_COLORS.length] };
    this.rows[id] = row;
    this.link.attach(id, pin);
    this.link.want(id, angle);
    this.emit("servos");
    this.changed();
    return row;
  }

  removeServo(id, confirm = true) {
    if (!(id in this.rows)) return;
    if (confirm) this.pushUndo();
    this.link.detach(id);
    delete this.rows[id];
    for (const f of this.frames) delete f.angles[String(id)];
    this.emit("servos"); this.emit("frames"); this.changed();
  }

  renameServo(id, name) {
    const r = this.rows[id]; if (!r) return;
    r.name = name; this.emit("servos-meta"); this.changed();
  }

  setAngle(id, v) {
    const r = this.rows[id]; if (!r) return;
    v = clamp(Math.round(v), 0, 180);
    if (r.angle !== v) { r.angle = v; this.emit("angle", id, v); }
    this.link.want(id, v);
  }

  pose() { const o = {}; for (const id of this.sids()) o[String(id)] = this.rows[id].angle; return o; }

  applyAngles(angles) {
    for (const [k, v] of Object.entries(angles)) this.setAngle(Number(k), v);
  }

  /** Servo 360 mantém o último valor girando: pausar/parar precisa mandá-lo ficar parado. */
  haltContinuous() {
    for (const r of Object.values(this.rows)) if (r.kind === "continuous" && r.angle !== 90) this.setAngle(r.id, 90);
  }

  // ───────────── interpolação ─────────────
  sortedFrames() { return [...this.frames].sort((a, b) => a.time - b.time); }
  static series(sid, fs) {
    const out = [];
    for (const f of fs) { const a = f.angles[String(sid)]; if (a !== undefined && a !== null) out.push({ t: +f.time, a: +a, e: f.ease || "linear", f }); }
    return out;
  }
  static sample(series, t) {
    if (!series.length) return null;
    if (t <= series[0].t) return series[0].a;
    const last = series[series.length - 1];
    if (t >= last.t) return last.a;
    for (let i = 0; i < series.length - 1; i++) {
      const s0 = series[i], s1 = series[i + 1];
      if (s0.t <= t && t <= s1.t) {
        const p = s1.t - s0.t <= 0 ? 1 : (t - s0.t) / (s1.t - s0.t);
        return s0.a + (s1.a - s0.a) * ease(p, s0.e);
      }
    }
    return last.a;
  }
  interpolate(t) {
    const fs = this.sortedFrames(), out = {};
    for (const sid of this.sids()) {
      const v = Store.sample(Store.series(sid, fs), t);
      if (v !== null) out[String(sid)] = Math.round(v);
    }
    return out;
  }
  lastTime() { return this.frames.reduce((m, f) => Math.max(m, +f.time), 0); }
  duration() { return this.durationOverride !== null ? this.durationOverride : this.lastTime(); }

  // ───────────── reprodução ─────────────
  play() {
    if (!this.frames.length || this.duration() <= 0) { this.say("Crie ao menos dois keyframes em tempos diferentes para reproduzir"); return; }
    if (this.playhead >= this.duration() - 0.01) this.playhead = 0;
    this._offset = this.playhead; this._start = performance.now();
    this.animating = true;
    this.emit("transport");
    this.say(this.link.ready ? "Reproduzindo" : "Reproduzindo em pré-visualização (Arduino desconectado)");
    cancelAnimationFrame(this._raf);
    this._raf = requestAnimationFrame(this._tick);
  }
  _tick(now) {
    if (!this.animating) return;
    const dur = this.duration();
    if (dur <= 0) { this.pause(); return; }
    let elapsed = this._offset + (now - this._start) / 1000;
    if (elapsed >= dur) {
      if (this.loopOn) { elapsed %= dur; this._offset = elapsed; this._start = now; }
      else {
        this.seek(dur, true);
        this.animating = false;
        this.haltContinuous();
        this.emit("transport");
        this.say("Fim da animação");
        return;
      }
    }
    this.seek(elapsed, true);
    this._raf = requestAnimationFrame(this._tick);
  }
  togglePlay() { this.animating ? this.pause() : this.play(); }
  pause() {
    const was = this.animating;
    this.animating = false;
    cancelAnimationFrame(this._raf);
    if (was) {
      this.seek(this.playhead, true);
      this.haltContinuous();
      this.emit("transport");
    }
  }
  stop() { this.pause(); this.haltContinuous(); this.seek(0); }
  toggleLoop() { this.loopOn = !this.loopOn; this.emit("transport"); this.say(this.loopOn ? "Loop ligado" : "Loop desligado"); }

  seek(t, fromPlay = false) {
    if (!fromPlay) this.pause();
    this.playhead = clamp(t, 0, 3600);
    if (this.frames.length) {
      const angles = this.interpolate(this.playhead);
      if (!fromPlay) for (const r of Object.values(this.rows)) if (r.kind === "continuous" && String(r.id) in angles) angles[String(r.id)] = 90;
      this.applyAngles(angles);
    }
    this.emit("playhead");
  }
  sortedTimes() { return [...new Set(this.frames.map((f) => Math.round(+f.time * 1000) / 1000))].sort((a, b) => a - b); }
  prevKeyframe() { const e = this.sortedTimes().filter((t) => t < this.playhead - 0.01); this.seek(e.length ? e[e.length - 1] : 0); }
  nextKeyframe() { const l = this.sortedTimes().filter((t) => t > this.playhead + 0.01); this.seek(l.length ? l[0] : this.duration()); }

  // ───────────── desfazer / refazer ─────────────
  pushUndo() {
    this.undoStack.push(structuredClone(this.frames));
    if (this.undoStack.length > 100) this.undoStack.shift();
    this.redoStack.length = 0;
    this.emit("history");
  }
  _restore(snap) {
    const keep = this.selected !== null && this.selected < snap.length ? this.selected : null;
    this.frames = snap; this.selected = keep;
    this.emit("frames"); this.emit("selection"); this.changed(); this.emit("history");
  }
  undo() {
    if (!this.undoStack.length) { this.say("Nada para desfazer"); return; }
    this.redoStack.push(structuredClone(this.frames));
    this._restore(this.undoStack.pop()); this.say("Desfeito");
  }
  redo() {
    if (!this.redoStack.length) { this.say("Nada para refazer"); return; }
    this.undoStack.push(structuredClone(this.frames));
    this._restore(this.redoStack.pop()); this.say("Refeito");
  }

  // ───────────── keyframes ─────────────
  selFrame() { return this.selected !== null && this.selected >= 0 && this.selected < this.frames.length ? this.frames[this.selected] : null; }
  timeTaken(t, except = null) { return this.frames.some((g) => g !== except && Math.abs(+g.time - t) < 0.03); }
  select(i) { this.selected = i; this.emit("selection"); }

  addFrame(at = null) {
    if (!this.sids().length) { this.say("Adicione ao menos um servo antes de criar keyframes"); return; }
    const t = Math.round(Math.max(0, at === null ? this.playhead : at) * 100) / 100;
    const existing = this.frames.find((f) => Math.abs(+f.time - t) < 0.03);
    this.pushUndo();
    let idx;
    if (existing) { existing.angles = this.pose(); idx = this.frames.indexOf(existing); this.say(`Pose do keyframe ${idx + 1} atualizada`); }
    else {
      const nf = { time: t, angles: this.pose(), ease: "ease_in_out" };
      this.frames.push(nf); this.frames.sort((a, b) => a.time - b.time);
      idx = this.frames.indexOf(nf); this.say(`Keyframe criado em ${t.toFixed(2)} s`);
    }
    this.selected = idx;
    this.emit("frames"); this.emit("selection"); this.changed();
  }
  updatePose() {
    const f = this.selFrame(); if (!f) return;
    this.pushUndo(); f.angles = this.pose();
    this.say(`Pose do keyframe ${this.selected + 1} atualizada`);
    this.emit("frames"); this.changed();
  }
  gotoSelected() { const f = this.selFrame(); if (f) this.seek(+f.time); }
  removeFrame() {
    const f = this.selFrame(); if (!f) return;
    this.pushUndo(); this.frames.splice(this.frames.indexOf(f), 1); this.selected = null;
    this.say("Keyframe removido (desfazer volta)");
    this.emit("frames"); this.emit("selection"); this.changed();
  }
  setEase(mode) {
    const f = this.selFrame(); if (!f) return;
    this.pushUndo(); f.ease = mode;
    this.emit("frames"); this.emit("selection"); this.changed();
    this.say("Interpolação: " + EASE_LABELS[mode]);
  }
  /** Altera o tempo do keyframe selecionado (campo do inspetor). */
  setSelectedTime(t) {
    t = clamp(Math.round(t * 100) / 100, 0, 3600);
    const f = this.selFrame();
    if (!f) { if (Math.abs(t - this.playhead) > 0.005) this.seek(t); return; }
    if (Math.abs(+f.time - t) < 1e-6) { this.emit("selection"); return; }
    if (this.timeTaken(t, f)) { this.say("Já existe um keyframe nesse tempo"); this.emit("selection"); return; }
    this.pushUndo(); f.time = t;
    this.frames.sort((a, b) => a.time - b.time); this.selected = this.frames.indexOf(f);
    this.emit("frames"); this.emit("selection"); this.changed();
  }
  // usados pelo arrastar na timeline (o desfazer é empilhado uma vez pelo chamador)
  dragFrameTime(f, t) {
    t = Math.max(0, Math.round(t * 100) / 100);
    if (Math.abs(t - +f.time) < 1e-9 || this.timeTaken(t, f)) return false;
    f.time = t; this.emit("frames-lite"); return true;
  }
  dragFrameAngle(f, sid, a) {
    f.angles[String(sid)] = a; this.setAngle(sid, a); this.emit("frames-lite");
  }
  finishDrag(f) {
    this.frames.sort((a, b) => a.time - b.time); this.selected = this.frames.indexOf(f);
    this.emit("frames"); this.emit("selection"); this.changed();
  }

  // ───────────── duração ─────────────
  setDuration(raw) {
    raw = String(raw).trim().toLowerCase().replace(",", ".");
    if (raw === "" || raw === "auto") { if (this.durationOverride !== null) { this.durationOverride = null; this.emit("frames"); this.changed(); } this.emit("duration"); return; }
    const v = parseFloat(raw);
    if (!(v >= 0.1 && v <= 3600)) { this.say("Duração inválida: use um valor entre 0.1 e 3600 segundos"); this.emit("duration"); return; }
    this.durationOverride = Math.max(v, this.lastTime());
    this.say(`Duração total: ${+this.durationOverride.toFixed(2)} s`);
    this.emit("duration"); this.emit("frames"); this.emit("playhead"); this.changed();
  }
  autoDuration() { this.durationOverride = null; this.emit("duration"); this.emit("frames"); this.emit("playhead"); this.changed(); }
  normalizeDuration() {
    const last = this.lastTime();
    if (this.durationOverride !== null && last > this.durationOverride) { this.durationOverride = last; this.emit("duration"); }
  }

  // ───────────── projeto (mesmo formato dos presets do motion.py) ─────────────
  toPreset() {
    return {
      servos: this.sids().map((id) => { const r = this.rows[id]; return { id, name: r.name, pin: r.pin, kind: r.kind }; }),
      duration: this.durationOverride,
      frames: this.sortedFrames().map((f) => ({ time: +f.time, angles: { ...f.angles }, ease: f.ease || "linear" })),
    };
  }

  clearProject() {
    this.pause();
    for (const id of this.sids()) this.removeServo(id, false);
    this.frames = []; this.selected = null; this.undoStack = []; this.redoStack = [];
  }

  loadPreset(preset, name) {
    this.clearProject();
    const seen = new Set();
    for (const s of preset.servos || []) {
      const sid = parseInt(s.id, 10), pin = parseInt(s.pin, 10);
      if (!(sid >= 0 && sid < MAX_SERVOS) || !(pin >= 2 && pin <= 53) || seen.has(pin) || sid in this.rows) continue;
      seen.add(pin);
      this.createServo(sid, String(s.name ?? `Servo ${sid + 1}`), pin, 90, s.kind === "continuous" ? "continuous" : "position");
    }
    for (const fd of preset.frames || []) {
      const t = parseFloat(fd.time ?? 0);
      if (!isFinite(t)) continue;
      const angles = {};
      for (const [k, v] of Object.entries(fd.angles || {})) { const n = parseInt(v, 10); if (isFinite(n)) angles[String(k)] = clamp(n, 0, 180); }
      const e = fd.ease in EASE_LABELS ? fd.ease : "linear";
      this.frames.push({ time: Math.max(0, t), angles, ease: e });
    }
    this.frames.sort((a, b) => a.time - b.time);
    let d = preset.duration !== undefined && preset.duration !== null ? parseFloat(preset.duration) : null;
    if (d !== null && !(d >= 0.1 && d <= 3600)) d = null;
    this.durationOverride = d !== null ? Math.max(d, this.lastTime()) : null;
    this.project = name;
    this.playhead = 0;
    this.emit("servos"); this.emit("frames"); this.emit("selection"); this.emit("duration"); this.emit("project"); this.emit("history");
    this.seek(0);
    this.changed();
    this.say("Preset carregado: " + name);
  }
}
