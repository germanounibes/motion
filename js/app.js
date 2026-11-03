// Motion Studio PWA — ligação da interface com o estado, a conexão serial e o armazenamento.
import { C, EASE_ORDER, EASE_LABELS, EASE_SHORT, EASE_COLORS, MAX_SERVOS, ease, fmtTime, fmtMs, fmtValue } from "./util.js";
import { Link } from "./link.js";
import { Store } from "./store.js";
import { Viewer } from "./viewer.js";
import { Timeline } from "./timeline.js";
import { kvGet, kvSet, requestPersistence } from "./storage.js";

const $ = (s, r = document) => r.querySelector(s);
const link = new Link();
const store = new Store(link);
window.motion = { link, store };        // útil para depurar no console

const ic = (n) => `<svg class="ic"><use href="#i-${n}"/></svg>`;
const setIcon = (btn, n) => { btn.querySelector("use").setAttribute("href", `#i-${n}`); };

// ───────────── aviso rápido (toast) ─────────────
let toastTimer = 0;
function say(msg) {
  const t = $("#toast"); t.textContent = msg; t.classList.add("show");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("show"), 2800);
}
store.on("status", say);

// ───────────── diálogos ─────────────
function askForm({ title, subtitle = "", fields, ok = "Confirmar" }) {
  return new Promise((resolve) => {
    const dlg = $("#dlg"), box = $("#dlgFields"), err = $("#dlgErr");
    $("#dlgTitle").textContent = title; $("#dlgSub").textContent = subtitle; $("#dlgOk").textContent = ok; err.textContent = "";
    box.innerHTML = "";
    const inputs = fields.map((f) => {
      const lab = document.createElement("label"); lab.textContent = f.label;
      let inp;
      if (f.choices) { inp = document.createElement("select"); f.choices.forEach((c) => { const o = document.createElement("option"); o.textContent = c; inp.appendChild(o); }); inp.value = f.value ?? f.choices[0]; }
      else { inp = document.createElement("input"); inp.type = "text"; inp.value = f.value ?? ""; inp.autocomplete = "off"; if (f.numeric) inp.inputMode = "numeric"; }
      lab.appendChild(inp); box.appendChild(lab); return inp;
    });
    let done = false;
    const finish = (val) => { if (done) return; done = true; $("#dlgForm").onsubmit = null; $("#dlgCancel").onclick = null; dlg.onclose = null; if (dlg.open) dlg.close(); resolve(val); };
    $("#dlgForm").onsubmit = (e) => {
      e.preventDefault();
      const out = {};
      for (let i = 0; i < fields.length; i++) {
        let v = inputs[i].value.trim();
        if (fields[i].validate) { const [val, msg] = fields[i].validate(v); if (msg) { err.textContent = msg; inputs[i].focus(); return; } v = val; }
        out[fields[i].key] = v;
      }
      finish(out);
    };
    $("#dlgCancel").onclick = () => finish(null);
    dlg.onclose = () => finish(null);
    dlg.showModal();
    if (inputs[0]) { inputs[0].focus(); inputs[0].select?.(); }
  });
}
function askConfirm(title, message, ok = "Confirmar") {
  return askForm({ title, subtitle: message, fields: [], ok }).then((r) => r !== null);
}

// ───────────── visualizador e linha do tempo ─────────────
const viewer = new Viewer($("#viewer"), store);
const timeline = new Timeline($("#timeline"), store);
timeline.onZoom = (pps) => { $("#zoomIn").value = pps; };
window.motion.timeline = timeline; window.motion.viewer = viewer;
viewer.invalidate(); timeline.repaint();

// ───────────── servos ─────────────
const cards = {};       // sid -> {val, range, root}
function paintRange(rng, row) {
  const pct = row.angle / 180 * 100;
  const s = row.kind === "continuous" ? Math.min(50, pct) : 0, e = row.kind === "continuous" ? Math.max(50, pct) : pct;
  rng.style.setProperty("--s", s + "%"); rng.style.setProperty("--e", e + "%");
}
function renderServos() {
  const list = $("#servoList"); list.innerHTML = "";
  for (const k of Object.keys(cards)) delete cards[k];
  const sids = store.sids();
  $("#servoCount").textContent = `${sids.length} / ${MAX_SERVOS}`;
  if (!sids.length) {
    list.innerHTML = `<div class="empty">Nenhum servo ainda.<br>Toque em <b>Adicionar</b> para ligar<br>o primeiro servo a um pino.</div>`;
    return;
  }
  for (const sid of sids) {
    const r = store.rows[sid];
    const el = document.createElement("div"); el.className = "scard"; el.style.setProperty("--c", r.color);
    el.innerHTML = `<div class="bar"></div><div class="sc-main">
      <div class="sc-top"><input class="sc-name" maxlength="24" aria-label="Nome do servo"><button class="ibtn" title="Remover servo">${ic("trash")}</button></div>
      <div class="sc-info"><span class="tag">D${r.pin}</span>${r.kind === "continuous" ? '<span class="tag c360">360</span>' : ""}<b class="sc-val"></b></div>
      <input class="srange" type="range" min="0" max="180" step="1" aria-label="Posição de ${r.name}"></div>`;
    const name = $(".sc-name", el), rng = $(".srange", el), val = $(".sc-val", el);
    name.value = r.name;
    name.addEventListener("input", () => store.renameServo(sid, name.value));
    name.addEventListener("keydown", (e) => { if (e.key === "Enter") name.blur(); });
    $(".ibtn", el).addEventListener("click", () => removeServo(sid));
    rng.value = r.angle; val.textContent = fmtValue(r.kind, r.angle); paintRange(rng, r);
    rng.addEventListener("input", () => store.setAngle(sid, +rng.value));
    rng.addEventListener("dblclick", () => store.setAngle(sid, 90));
    cards[sid] = { val, rng };
    list.appendChild(el);
  }
}
store.on("servos", renderServos);
store.on("angle", (sid, v) => {
  const c = cards[sid], r = store.rows[sid]; if (!c || !r) return;
  c.val.textContent = fmtValue(r.kind, v);
  if (+c.rng.value !== v) c.rng.value = v;
  paintRange(c.rng, r);
});

async function addServo() {
  const sid = store.nextFreeId();
  if (sid === null) { await askConfirm("Limite atingido", `O painel suporta até ${MAX_SERVOS} servos.`, "OK"); return; }
  const kinds = ["Posição (0° a 180°)", "Rotação contínua (360°)"];
  const res = await askForm({
    title: "Novo servo",
    subtitle: "Dê um nome ao servo e informe o pino digital do Arduino Mega onde ele está ligado. Servo 360 não tem ângulo: o valor é a velocidade (parado no centro).",
    ok: "Adicionar servo",
    fields: [
      { key: "name", label: "Nome", value: `Servo ${sid + 1}`, validate: (s) => [s || `Servo ${sid + 1}`, null] },
      { key: "pin", label: "Pino digital (2 a 53)", value: String(store.defaultPin()), numeric: true,
        validate: (s) => { const p = parseInt(s, 10); if (!/^\d+$/.test(s)) return [null, "Informe o número do pino, de 2 a 53."]; if (!(p >= 2 && p <= 53)) return [null, "O pino precisa estar entre 2 e 53."]; if (store.pinInUse(p)) return [null, `O pino ${p} já está em uso por outro servo.`]; return [p, null]; } },
      { key: "kind", label: "Tipo", choices: kinds, value: kinds[0], validate: (s) => [s === kinds[1] ? "continuous" : "position", null] },
    ],
  });
  if (!res) return;
  store.createServo(sid, res.name, res.pin, 90, res.kind);
  say(`“${res.name}” adicionado no pino ${res.pin}`);
}
async function removeServo(sid) {
  const r = store.rows[sid]; if (!r) return;
  if (store.frames.length && !(await askConfirm("Remover servo", `Remover “${r.name}”? Os keyframes desse servo serão apagados.`, "Remover"))) return;
  store.removeServo(sid, true);
}
$("#btnAdd").addEventListener("click", addServo);

// ───────────── transporte ─────────────
const tcMain = $(".tc-main"), tcMs = $(".tc-ms"), tcTot = $(".tc-tot");
function updateTimecode() {
  tcMain.textContent = fmtTime(store.playhead, false); tcMs.textContent = fmtMs(store.playhead);
  tcTot.textContent = "/ " + fmtTime(store.duration());
}
store.on("playhead", () => { updateTimecode(); if (store.selected === null && document.activeElement !== $("#frameTime")) $("#frameTime").value = store.playhead.toFixed(2); });
store.on("duration", () => { updateDuration(); updateTimecode(); });
store.on("frames", updateTimecode);
function updateTransport() {
  setIcon($("#bPlay"), store.animating ? "pause" : "play");
  $("#bLoop").classList.toggle("on", store.loopOn);
}
store.on("transport", updateTransport);
$("#bPlay").addEventListener("click", () => store.togglePlay());
$("#bStop").addEventListener("click", () => store.stop());
$("#bPrev").addEventListener("click", () => store.prevKeyframe());
$("#bNext").addEventListener("click", () => store.nextKeyframe());
$("#bLoop").addEventListener("click", () => store.toggleLoop());
$("#bKey").addEventListener("click", () => store.addFrame());
$("#bKey2").addEventListener("click", () => store.addFrame());

// ───────────── linha do tempo: barra de ferramentas ─────────────
function updateDuration() {
  const d = store.durationOverride; $("#durIn").value = d === null ? "Auto" : String(+d.toFixed(2));
}
$("#durIn").addEventListener("change", () => store.setDuration($("#durIn").value));
$("#durIn").addEventListener("keydown", (e) => { if (e.key === "Enter") e.target.blur(); });
$("#bAuto").addEventListener("click", () => store.autoDuration());
$("#bUndo").addEventListener("click", () => store.undo());
$("#bRedo").addEventListener("click", () => store.redo());
$("#bZoomIn").addEventListener("click", () => timeline.zoomAt(1.3));
$("#bZoomOut").addEventListener("click", () => timeline.zoomAt(1 / 1.3));
$("#bFit").addEventListener("click", () => timeline.fitAll());
$("#zoomIn").addEventListener("input", (e) => timeline.setPps(+e.target.value));
const syncHistory = () => { $("#bUndo").disabled = !store.undoStack.length; $("#bRedo").disabled = !store.redoStack.length; };
store.on("history", syncHistory);
for (const ev of ["frames", "selection"]) store.on(ev, syncHistory);
syncHistory();

// ───────────── inspetor ─────────────
const easeBox = $("#easePicker");
for (const mode of EASE_ORDER) {
  const b = document.createElement("button"); b.className = "ease"; b.dataset.mode = mode; b.style.setProperty("--ec", EASE_COLORS[mode]);
  let d = ""; for (let k = 0; k <= 24; k++) { const p = k / 24; d += (k ? "L" : "M") + (4 + 32 * p).toFixed(1) + " " + (30 - 26 * ease(p, mode)).toFixed(1); }
  b.innerHTML = `<svg viewBox="0 0 40 34"><path d="${d}"/></svg><span>${EASE_SHORT[mode]}</span>`;
  b.title = EASE_LABELS[mode];
  b.addEventListener("click", () => store.setEase(mode));
  easeBox.appendChild(b);
}
function updateInspector() {
  const f = store.selFrame();
  if (f === null && store.selected !== null) store.selected = null;
  $("#selLabel").textContent = f ? `Keyframe ${store.selected + 1}` : "Nenhum keyframe selecionado";
  $("#selChip").classList.toggle("on", !!f);
  $("#selChip use").setAttribute("href", f ? "#i-diamond" : "#i-diamond-o");
  $("#frameTime").value = (f ? +f.time : store.playhead).toFixed(2);
  for (const b of easeBox.children) { b.classList.toggle("sel", !!f && (f.ease || "linear") === b.dataset.mode); b.disabled = !f; }
  for (const id of ["#bRemove", "#bUpdatePose", "#bGoto"]) $(id).disabled = !f;
}
store.on("selection", updateInspector);
store.on("frames", updateInspector);
store.on("frames-lite", () => { const f = store.selFrame(); if (f) $("#frameTime").value = (+f.time).toFixed(2); });
const applyTime = () => { const v = parseFloat($("#frameTime").value.replace(",", ".")); if (isNaN(v)) updateInspector(); else store.setSelectedTime(v); };
$("#frameTime").addEventListener("change", applyTime);
$("#frameTime").addEventListener("keydown", (e) => { if (e.key === "Enter") e.target.blur(); });
$("#bRemove").addEventListener("click", () => store.removeFrame());
$("#bAddFrame").addEventListener("click", () => store.addFrame());
$("#bUpdatePose").addEventListener("click", () => store.updatePose());
$("#bGoto").addEventListener("click", () => store.gotoSelected());

// ───────────── presets (IndexedDB) ─────────────
let presets = {}, presetName = "";
function renderPresets() {
  const ul = $("#presetList"), names = Object.keys(presets).sort((a, b) => a.localeCompare(b));
  ul.innerHTML = "";
  if (presetName && !names.includes(presetName)) presetName = "";
  if (!presetName && names.length) presetName = names[0];
  if (!names.length) { ul.innerHTML = '<li class="none">Nenhum preset salvo</li>'; return; }
  for (const n of names) {
    const li = document.createElement("li"); li.textContent = n; li.classList.toggle("sel", n === presetName);
    li.addEventListener("click", () => { presetName = n; renderPresets(); });
    li.addEventListener("dblclick", () => loadSelected());
    ul.appendChild(li);
  }
}
async function loadPresets() { const p = await kvGet("presets"); presets = p && typeof p === "object" ? p : {}; renderPresets(); }
const writePresets = () => kvSet("presets", presets);

async function savePreset() {
  if (!store.frames.length) { await askConfirm("Nada para salvar", "Crie pelo menos um keyframe antes de salvar.", "OK"); return; }
  const cur = store.project !== "Sem título" ? store.project : presetName;
  const res = await askForm({ title: "Salvar animação", subtitle: "Guarda servos, pinos, keyframes e duração para abrir depois.", ok: "Salvar",
    fields: [{ key: "name", label: "Nome do preset", value: cur || "Minha animação", validate: (s) => (s ? [s, null] : [null, "Dê um nome para a animação."]) }] });
  if (!res) return;
  if (res.name in presets && !(await askConfirm("Substituir preset?", `“${res.name}” já existe. Substituir?`, "Substituir"))) return;
  presets[res.name] = store.toPreset(); await writePresets();
  presetName = res.name; store.project = res.name; updateProject(); renderPresets(); say(`Preset salvo: ${res.name}`);
}
function loadSelected() {
  if (!(presetName in presets)) { say("Escolha um preset na lista para carregar."); return; }
  store.loadPreset(presets[presetName], presetName);
  timeline.fitAll();
}
async function deletePreset() {
  if (!(presetName in presets)) return;
  if (!(await askConfirm("Excluir preset", `Excluir “${presetName}” permanentemente?`, "Excluir"))) return;
  const n = presetName; delete presets[n]; await writePresets(); renderPresets(); say(`Preset excluído: ${n}`);
}
function download(name, text) {
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([text], { type: "application/json" })); a.download = name;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
$("#bSave").addEventListener("click", savePreset);
$("#bLoad").addEventListener("click", loadSelected);
$("#bDelPreset").addEventListener("click", deletePreset);
$("#bExport").addEventListener("click", () => { download("servo_presets_mega.json", JSON.stringify(presets, null, 2)); say("Presets exportados"); });
$("#bImport").addEventListener("click", () => $("#fileIn").click());
$("#fileIn").addEventListener("change", async (e) => {
  const file = e.target.files[0]; e.target.value = ""; if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("O arquivo precisa conter um objeto JSON de presets.");
    const single = Array.isArray(data.servos) || Array.isArray(data.frames);     // um preset solto
    const add = single ? { [file.name.replace(/\.json$/i, "")]: data } : data;
    Object.assign(presets, add); await writePresets(); renderPresets(); say(`Presets importados: ${Object.keys(add).length}`);
  } catch (err) { await askConfirm("Importar presets", String(err.message || err), "OK"); }
});

// ───────────── projeto ─────────────
function updateProject() { $("#projectChip").textContent = store.project; }
store.on("project", updateProject);
$("#projectChip").addEventListener("click", async () => {
  const r = await askForm({ title: "Nome do projeto", fields: [{ key: "name", label: "Nome", value: store.project === "Sem título" ? "" : store.project, validate: (s) => [s || "Sem título", null] }], ok: "OK" });
  if (r) { store.project = r.name; updateProject(); store.changed(); }
});
let saveTimer = 0;
store.on("dirty", () => { clearTimeout(saveTimer); saveTimer = setTimeout(() => kvSet("autosave", { name: store.project, preset: store.toPreset() }), 500); });

// ───────────── conexão ─────────────
const logBox = $("#log");
link.on("log", (kind, text) => {
  const d = document.createElement("div"); d.className = kind;
  d.textContent = (kind === "tx" ? "→ " : kind === "rx" ? "← " : "· ") + text; logBox.appendChild(d);
  while (logBox.childElementCount > 300) logBox.firstChild.remove();
  logBox.scrollTop = logBox.scrollHeight;
});
link.on("error", (m) => say(m));
function renderConn() {
  const s = link.state, pill = $("#connPill");
  pill.className = "pill " + (s === "online" ? "on" : s === "connecting" ? "wait" : "");
  $("#connTxt").textContent = s === "online" ? "Online" : s === "connecting" ? "Conectando…" : "Offline";
  const live = $("#livePill"); live.className = "pill static " + (s === "online" ? "on" : "");
  $("span", live).textContent = s === "online" ? "Ao vivo" : "Pré-visualização";
  const label = s === "offline" ? "Conectar" : s === "connecting" ? "Aguarde…" : "Desconectar";
  for (const b of [$("#btnConnect"), $("#connGo")]) { $("span", b).textContent = label; b.disabled = s === "connecting"; }
  $("#cmd").disabled = $("#cmdSend").disabled = s !== "online";
}
link.on("state", () => { renderConn(); if (link.state === "online") say("Conectado ao Arduino"); else if (link.state === "offline") say("Desconectado do Arduino"); });
const toggleLink = () => (link.state === "offline" ? link.connect() : link.disconnect());
$("#btnConnect").addEventListener("click", toggleLink);
$("#connGo").addEventListener("click", toggleLink);
$("#connPill").addEventListener("click", () => { renderChecks(); $("#connDlg").showModal(); });
$("#connClose").addEventListener("click", () => $("#connDlg").close());
$("#forcePoly").addEventListener("change", (e) => { link.forcePolyfill = e.target.checked; });
$("#cmdForm").addEventListener("submit", (e) => { e.preventDefault(); const c = $("#cmd").value.trim(); if (c) link.send(c); $("#cmd").value = ""; });
function renderChecks() {
  const ua = navigator.userAgent, ul = $("#checks");
  const rows = [
    [window.isSecureContext, "Contexto seguro (HTTPS ou localhost)", "abra por HTTPS, senão o navegador bloqueia USB/serial."],
    [Link.hasNative, "Web Serial nativo", "este navegador não tem navigator.serial."],
    [Link.hasUsb, "WebUSB (usado pelo polyfill)", "este navegador não tem navigator.usb."],
    [/Chrome\//.test(ua) && !/Firefox|FxiOS/.test(ua), "Navegador Chromium", "use o Chrome no Android."],
  ];
  ul.innerHTML = "";
  for (const [ok, label, why] of rows) { const li = document.createElement("li"); li.className = ok ? "ok" : "bad"; li.textContent = label + (ok ? "" : " — " + why); ul.appendChild(li); }
  const m = document.createElement("li"); m.className = Link.hasNative ? "ok" : Link.hasUsb ? "warn" : "bad";
  m.textContent = Link.hasNative ? "Modo: Web Serial nativo" : Link.hasUsb ? "Modo: polyfill via WebUSB" : "Modo: indisponível neste navegador"; ul.appendChild(m);
  if (Link.hasUsb && (!Link.hasNative || /Android/i.test(navigator.userAgent))) { $("#forcePoly").checked = true; link.forcePolyfill = true; }
  $("#forcePoly").disabled = !Link.hasNative;
}
renderConn();

// ───────────── abas e posição do transporte ─────────────
function setTab(t) {
  document.body.dataset.tab = t;
  for (const b of document.querySelectorAll("#tabs button")) b.classList.toggle("on", b.dataset.tab === t);
  requestAnimationFrame(() => { viewer.invalidate(); timeline.repaint(); });
}
for (const b of document.querySelectorAll("#tabs button")) b.addEventListener("click", () => setTab(b.dataset.tab));
const narrow = matchMedia("(max-width: 999px)");
function placeTransport() {
  const tr = $("#transport");
  (narrow.matches ? $("#dock") : $("#vSlot")).appendChild(tr);
  $("#bKey").style.display = narrow.matches ? "" : "none";
  requestAnimationFrame(() => { viewer.invalidate(); timeline.repaint(); });
}
narrow.addEventListener("change", placeTransport);
placeTransport();

// ───────────── atalhos ─────────────
const typing = () => { const a = document.activeElement; return a && (a.tagName === "TEXTAREA" || a.tagName === "SELECT" || (a.tagName === "INPUT" && !["range", "checkbox", "button"].includes(a.type))); };
document.addEventListener("keydown", (e) => {
  if (document.querySelector("dialog[open]")) return;
  const k = e.key, mod = e.ctrlKey || e.metaKey;
  if (mod) {
    if (k === "z" || k === "Z") { e.preventDefault(); e.shiftKey ? store.redo() : store.undo(); }
    else if (k === "y") { e.preventDefault(); store.redo(); }
    else if (k === "s") { e.preventDefault(); savePreset(); }
    return;
  }
  if (typing()) { if (k === "Escape") document.activeElement.blur(); return; }
  const h = {
    " ": () => store.togglePlay(), k: () => store.addFrame(), K: () => store.addFrame(), l: () => store.toggleLoop(),
    Delete: () => store.removeFrame(), Backspace: () => store.removeFrame(), Home: () => store.seek(0), End: () => store.seek(store.duration()),
    ArrowLeft: () => store.seek(store.playhead - (e.shiftKey ? 1 : 0.1)), ArrowRight: () => store.seek(store.playhead + (e.shiftKey ? 1 : 0.1)),
  }[k];
  if (h) { e.preventDefault(); h(); }
});
document.addEventListener("keyup", (e) => { if (e.key === " " && !typing() && !document.querySelector("dialog[open]")) e.preventDefault(); });

// ───────────── início ─────────────
(async function init() {
  updateInspector(); updateTimecode(); updateDuration(); updateProject(); renderServos(); updateTransport();
  await loadPresets();
  const auto = await kvGet("autosave");
  if (auto && auto.preset && ((auto.preset.servos || []).length || (auto.preset.frames || []).length)) {
    store.loadPreset(auto.preset, auto.name || "Sem título");
    say("Projeto anterior restaurado");
  }
  requestPersistence();
  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) navigator.serviceWorker.register("sw.js").catch(() => {});
  window.motionReady = true;
  window.addEventListener("pagehide", () => { if (link.ready) for (const sid of link.pins.keys()) link.send(`DETACH,${sid}`); });
})();
