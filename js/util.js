// Constantes e funções puras (portadas do motion.py)
export const C = {
  INK: "#140d2e", BG: "#241a4d", BAR: "#2e2260", PANEL: "#352968", CARD: "#463a85", CARD_HI: "#5547a0",
  LINE_HI: "#6a5cb8", TEXT: "#fff6e0", DIM: "#cdc2f5", FAINT: "#8f82cf", ACCENT: "#ffd23f",
  ACCENT_HI: "#ffe68a", PLAYHEAD: "#3ff0c8", SELECT: "#ff5ca8", GREEN: "#3ff0a0", RED: "#ff5d73",
};
export const TRACK_COLORS = ["#ff6b8b", "#3ff0c8", "#ffd23f", "#6bb8ff", "#b48cff", "#8cf06b",
  "#ff9a4c", "#ff7ae0", "#4cd9f0", "#ffe27a", "#a0ff6b", "#ff8f8f"];
export const EASE_ORDER = ["linear", "ease_in", "ease_out", "ease_in_out", "hold"];
export const EASE_LABELS = { linear: "Linear", ease_in: "Ease In", ease_out: "Ease Out", ease_in_out: "Ease In-Out", hold: "Manter posição" };
export const EASE_SHORT = { linear: "Linear", ease_in: "Ease In", ease_out: "Ease Out", ease_in_out: "In-Out", hold: "Hold" };
export const EASE_COLORS = { linear: "#cdc2f5", ease_in: "#3ff0c8", ease_out: "#ffd23f", ease_in_out: "#6bb8ff", hold: "#ff6b8b" };
export const MAX_SERVOS = 12;
export const BAUD = 115200;
export const FONT = '"Fredoka","Baloo 2","Nunito","Quicksand",system-ui,-apple-system,"Segoe UI",Roboto,sans-serif';
export const FONT_MONO = '"Source Code Pro","JetBrains Mono","SF Mono",Consolas,Menlo,"DejaVu Sans Mono","Courier New",monospace';

export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
export function mix(a, b, t) {
  const A = rgb(a), B = rgb(b);
  return "#" + A.map((x, i) => Math.trunc(x + (B[i] - x) * t).toString(16).padStart(2, "0")).join("");
}
export const lighten = (c, t) => mix(c, "#ffffff", t);

export function ease(p, mode) {
  p = clamp(p, 0, 1);
  if (mode === "ease_in") return p * p;
  if (mode === "ease_out") return 1 - (1 - p) * (1 - p);
  if (mode === "ease_in_out") return p * p * (3 - 2 * p);
  if (mode === "hold") return p < 1 ? 0 : 1;
  return p;
}

const p2 = (n) => String(n).padStart(2, "0");
export function fmtTime(t, ms = true) {
  t = Math.max(0, t);
  const m = Math.floor(t / 60), s = t - m * 60, si = Math.floor(s);
  if (ms) return `${p2(m)}:${p2(si)}.${String(Math.round((s - si) * 1000) % 1000).padStart(3, "0")}`;
  return `${p2(m)}:${p2(si)}`;
}
export function fmtMs(t) { return "." + String(Math.round((t % 1) * 1000) % 1000).padStart(3, "0"); }

/** Servo de posição mostra graus; servo 360 mostra velocidade (90 = parado). */
export function fmtValue(kind, v) {
  if (kind === "continuous") {
    const pct = Math.round((v - 90) / 90 * 100);
    return pct === 0 ? "Parado" : (pct > 0 ? "+" : "") + pct + "%";
  }
  return v + "°";
}

/** Caminho de retângulo arredondado (sem desenhar). */
export function rrect(ctx, x1, y1, x2, y2, r) {
  r = Math.max(0, Math.min(r, (x2 - x1) / 2, (y2 - y1) / 2));
  ctx.beginPath();
  ctx.moveTo(x1 + r, y1);
  ctx.arcTo(x2, y1, x2, y2, r);
  ctx.arcTo(x2, y2, x1, y2, r);
  ctx.arcTo(x1, y2, x1, y1, r);
  ctx.arcTo(x1, y1, x2, y1, r);
  ctx.closePath();
}
/** Preenche e/ou contorna um retângulo arredondado. */
export function drawRR(ctx, x1, y1, x2, y2, r, fill, stroke, lw = 2) {
  rrect(ctx, x1, y1, x2, y2, r);
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.stroke(); }
}
export function circle(ctx, x, y, r, fill, stroke, lw = 2) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.stroke(); }
}
export function diamond(ctx, x, y, r, fill, stroke, lw = 2.5) {
  ctx.beginPath();
  ctx.moveTo(x, y - r); ctx.lineTo(x + r, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r, y); ctx.closePath();
  ctx.lineJoin = "round";
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.stroke(); }
}

/** Ajusta um canvas ao tamanho CSS e ao devicePixelRatio. Devolve {w, h, dpr, changed}. */
export function fitCanvas(cv) {
  const dpr = Math.min(3, window.devicePixelRatio || 1);
  const w = Math.max(1, Math.round(cv.clientWidth)), h = Math.max(1, Math.round(cv.clientHeight));
  const changed = cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr);
  if (changed) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
  return { w, h, dpr, changed };
}

export class Emitter {
  constructor() { this._h = {}; }
  on(ev, fn) { (this._h[ev] ||= []).push(fn); return () => { this._h[ev] = this._h[ev].filter((f) => f !== fn); }; }
  emit(ev, ...a) { for (const f of this._h[ev] || []) { try { f(...a); } catch (e) { console.error(e); } } }
}

/** Agenda uma função para o próximo quadro (várias chamadas viram uma só). */
export function rafOnce(fn) {
  let pending = false;
  return () => { if (pending) return; pending = true; requestAnimationFrame(() => { pending = false; fn(); }); };
}
