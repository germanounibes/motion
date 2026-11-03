(() => {
  const dec = new TextDecoder(); window.__written = [];
  class P { constructor(){ this.readable = new ReadableStream({start:(c)=>{this.ctl=c}}); this.writable = new WritableStream({write:(ch)=>{window.__written.push(dec.decode(ch))}}); } async open(){} async close(){} }
  const port = new P();
  Object.defineProperty(navigator, 'serial', {value:{requestPort: async()=>port}, configurable:true});
})();
