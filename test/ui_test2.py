import sys, time, json
sys.path.insert(0, ".")
from cdp import Chrome
OUT = sys.argv[1]
URL = "http://localhost:8766/motion-pwa/index.html"
MOCK = open("mock.js").read()
c = Chrome(port=9334, profile="/home/ideapad-300/chrome-test-profile2")
res = []
def ok(cond, msg): res.append(("PASS " if cond else "FAIL ") + msg); print(res[-1])
try:
    c.call("Page.enable"); c.call("Runtime.enable")
    c.call("Page.addScriptToEvaluateOnNewDocument", source=MOCK)
    c.size(412, 800)
    c.call("Page.navigate", url=URL)
    for _ in range(40):
        time.sleep(.25)
        if c.js("window.motionReady === true"): break
    c.js("indexedDB.deleteDatabase('motion-studio') && 0"); time.sleep(.3)
    c.call("Page.navigate", url=URL + "?x=1"); time.sleep(1.5)
    c.js("""(async()=>{const r=await (await fetch('../servo_presets_mega.json')).json(); const {store}=window.motion; store.loadPreset(r.ambiente,'ambiente'); })()""")
    time.sleep(.5)
    # ---- conexão pela interface ----
    c.js("document.querySelector('#btnConnect').click()"); time.sleep(.5)
    ok(c.js("document.querySelector('#connTxt').textContent") == "Conectando…", "pílula 'Conectando…' durante o reinício")
    time.sleep(2.0)
    ok(c.js("document.querySelector('#connTxt').textContent") == "Online", "pílula Online")
    w = c.js("window.__written.join('')")
    ok("ATTACH,0,9\n" in w and "ATTACH,2,10\n" in w, "ATTACH enviado: " + json.dumps(w[:60]))
    # slider do servo 1 (aba servos)
    c.js("document.querySelector('#tabs [data-tab=servos]').click()"); time.sleep(.3)
    c.js("window.__written.length=0")
    c.js("(()=>{const r=document.querySelectorAll('.srange')[1]; r.value=33; r.dispatchEvent(new Event('input',{bubbles:true}))})()"); time.sleep(.2)
    ok("MOVE,1,33\n" in c.js("window.__written.join('')"), "slider move o servo 1 -> MOVE,1,33")
    # arrastar o mostrador (aba cena) com o dedo
    c.js("document.querySelector('#tabs [data-tab=scene]').click()"); time.sleep(.5)
    card = c.js("(()=>{const v=window.motion; return null})()")
    box = c.js("(()=>{const r=document.querySelector('#viewer').getBoundingClientRect();return [r.left,r.top,r.width,r.height]})()")
    # primeiro cartão: topo-esquerdo; o centro do arco fica ~ (x1+w/2, y1+44+R)
    c.js("window.__written.length=0")
    x, y = box[0] + box[2] * .27, box[1] + box[3] * .30
    c.touch("touchStart", [(x, y)]); c.touch("touchMove", [(x + 30, y - 10)]); c.touch("touchEnd", []); time.sleep(.3)
    a0 = c.js("window.motion.store.rows[0].angle")
    ok(a0 != 90, f"arrastar o mostrador mudou o servo 0 para {a0}°")
    # ---- play ----
    c.js("document.querySelector('#bPlay').click()"); time.sleep(1.2)
    ph = c.js("window.motion.store.playhead")
    ok(c.js("window.motion.store.animating") and ph > 0.5, f"reprodução avançou o playhead: {ph:.2f}s")
    ok("MOVE," in c.js("window.__written.join('')"), "reprodução envia MOVE ao Arduino")
    c.js("document.querySelector('#bPlay').click()"); time.sleep(.2)
    ok(not c.js("window.motion.store.animating"), "pause")
    # ---- timeline por toque ----
    c.js("document.querySelector('#tabs [data-tab=timeline]').click()"); time.sleep(.6)
    info = c.js("""(()=>{const t=document.querySelector('#timeline').getBoundingClientRect(); return {l:t.left,t:t.top,w:t.width,h:t.height}})()""")
    kf = c.js("""(()=>{const tl=window.__tl; return null})()""")
    # expõe a timeline para o teste
    hit = c.js("""(async()=>{const m=await import('./js/timeline.js'); return null})()""")
    pos = c.js("""(()=>{const cv=document.querySelector('#timeline'); const r=cv.getBoundingClientRect();
        const T=window.motion.timeline; const h=T.hits.find(h=>h.type==='kf'&&h.sid===null&&h.idx===3);
        return [r.left+T.headW+h.x-T.sx, r.top+T.RULER_H+h.y-T.sy, T.pps]})()""") if c.js("!!window.motion.timeline") else None
    ok(pos is not None, "timeline exposta em window.motion")
    if pos:
        t0 = c.js("window.motion.store.frames[3].time")
        c.touch("touchStart", [(pos[0], pos[1])]); 
        for dx in (6, 14, 24): c.touch("touchMove", [(pos[0] + dx, pos[1])])
        c.touch("touchEnd", []); time.sleep(.3)
        t1 = c.js("window.motion.store.frames.map(f=>f.time)[3]")
        ok(abs(t1 - t0) > 0.02, f"arrastar keyframe com o dedo: {t0} -> {t1}")
        c.js("window.motion.store.undo()"); time.sleep(.1)
        ok(abs(c.js("window.motion.store.frames[3].time") - t0) < 1e-9, "desfazer volta o tempo")
        # pinça
        p0 = c.js("window.motion.timeline.pps")
        cx, cy = info["l"] + info["w"] * .6, info["t"] + info["h"] * .6
        c.touch("touchStart", [(cx - 30, cy), (cx + 30, cy)])
        for d in (50, 80, 110): c.touch("touchMove", [(cx - d, cy), (cx + d, cy)])
        c.touch("touchEnd", []); time.sleep(.3)
        p1 = c.js("window.motion.timeline.pps")
        ok(p1 > p0 * 1.5, f"pinça aproxima a timeline: {p0:.1f} -> {p1:.1f} px/s")
        # toque simples na régua move o playhead
        c.touch("touchStart", [(info["l"] + 200, info["t"] + 14)]); c.touch("touchEnd", []); time.sleep(.2)
        ok(c.js("window.motion.store.playhead") > 0, "toque na régua move o playhead: %.2f" % c.js("window.motion.store.playhead"))
        c.shot(f"{OUT}/phone_timeline_zoom.png")
    # ---- preset ----
    c.js("document.querySelector('#tabs [data-tab=inspector]').click()"); time.sleep(.3)
    c.js("document.querySelector('#bSave').click()"); time.sleep(.4)
    ok(c.js("document.querySelector('#dlg').open"), "diálogo Salvar abriu")
    c.js("(()=>{const i=document.querySelector('#dlgFields input'); i.value='teste-pwa'; document.querySelector('#dlgForm').requestSubmit()})()"); time.sleep(.6)
    ok("teste-pwa" in (c.js("indexedDB && new Promise(r=>{const q=indexedDB.open('motion-studio');q.onsuccess=()=>{const g=q.result.transaction('kv').objectStore('kv').get('presets');g.onsuccess=()=>r(g.result)}})") or {}), "preset gravado no IndexedDB")
    c.shot(f"{OUT}/phone_inspector2.png")
    # recarregar: autosave restaura o projeto
    c.call("Page.navigate", url=URL + "?x=2"); time.sleep(2)
    ok(c.js("window.motion.store.sids().length") == 3 and c.js("window.motion.store.frames.length") == 10, "autosave restaurou o projeto ao reabrir")
    # desconectar
    c.js("document.querySelector('#btnConnect').click()"); time.sleep(2.3)
    c.js("window.__written.length=0"); c.js("document.querySelector('#btnConnect').click()"); time.sleep(.5)
    c.js("document.querySelector('#tabs [data-tab=scene]').click()"); time.sleep(2)
    c.shot(f"{OUT}/phone_online.png")
    c.js("document.querySelector('#btnConnect').click()"); time.sleep(.6)
    ok("DETACH,0\n" in c.js("window.__written.join('')"), "desconectar envia DETACH")
    print("console:", c.console[:10])
finally:
    c.close()
print(sum(r.startswith("FAIL") for r in res), "falhas")
