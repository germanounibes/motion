import sys, time, json
sys.path.insert(0, ".")
from cdp import Chrome

OUT = sys.argv[1]
URL = "http://localhost:8766/motion-pwa/index.html"
MOCK = """
(() => {
  const dec = new TextDecoder(); window.__written = [];
  class P { constructor(){ this.readable = new ReadableStream({start:(c)=>{this.ctl=c}}); this.writable = new WritableStream({write:(ch)=>{window.__written.push(dec.decode(ch))}}); }
    async open(){} async close(){} }
  const port = new P();
  Object.defineProperty(navigator, 'serial', {value:{requestPort: async()=>port}, configurable:true});
})();
"""
c = Chrome()
try:
    c.call("Page.enable"); c.call("Runtime.enable")
    c.call("Page.addScriptToEvaluateOnNewDocument", source=MOCK)
    def load(w, h, mobile=True, dpr=2):
        c.size(w, h, mobile, dpr)
        c.call("Page.navigate", url=URL + "?r=%d" % time.time())
        for _ in range(40):
            time.sleep(.25)
            if c.js("window.motionReady === true"): break
        time.sleep(.4)
    load(412, 800)
    c.js("indexedDB.deleteDatabase('motion-studio'), 1")
    load(412, 800)
    print("title:", c.js("document.title"), "| sw:", c.js("'serviceWorker' in navigator"))
    # carrega o preset real do desktop
    c.js("""(async()=>{const r=await (await fetch('../servo_presets_mega.json')).json(); window.__real=r;
       const {store}=window.motion; store.loadPreset(r.ambiente,'ambiente'); store.createServo(3,'roda',11,90,'continuous'); store.setAngle(3,140); })()""")
    time.sleep(.6)
    shots = {}
    for tab in ("scene", "servos", "timeline", "inspector"):
        c.js(f"document.querySelector('#tabs [data-tab={tab}]').click()"); time.sleep(.5)
        c.shot(f"{OUT}/phone_{tab}.png")
    # horizontal
    load(800, 360)
    c.js("(async()=>{const {store}=window.motion; if(!store.sids().length){store.loadPreset(window.__real?.ambiente||{servos:[],frames:[]},'x')} })()")
    # desktop
    load(1366, 768, mobile=False, dpr=1)
    c.js("""(async()=>{const r=await (await fetch('../servo_presets_mega.json')).json(); const {store}=window.motion; store.loadPreset(r.ambiente,'ambiente'); store.createServo(3,'roda',11,90,'continuous'); store.setAngle(3,140); store.seek(0.5); })()""")
    time.sleep(.8)
    c.shot(f"{OUT}/desktop.png")
    print("console:", c.console[:10])
finally:
    c.close()
